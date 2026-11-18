use novel_studio_lib::{
    db::Database,
    files,
    model::{id, Chapter, Project},
    reader_fonts::{ReaderFontAsset, MAX_FONT},
};
use std::io::{Read, Write};

const A: &[u8] = include_bytes!("fixtures/fonts/fixture-a.ttf");
const B: &[u8] = include_bytes!("fixtures/fonts/fixture-b.ttf");
const C: &[u8] = include_bytes!("fixtures/fonts/fixture-c.otf");

fn asset(bytes: &[u8]) -> ReaderFontAsset {
    ReaderFontAsset::from_bytes(bytes.to_vec()).unwrap()
}
fn project() -> Project {
    let mut p = Project::new("字体测试作品".into());
    p.chapters.push(Chapter {
        working: "灯塔😀旁的信笺".into(),
        ..Default::default()
    });
    p.reader.chapter_id = p.chapters[0].id.clone();
    p.reader.offset = 4;
    p
}

#[test]
fn parses_real_ttf_otf_and_rejects_invalid_truncated_collections_and_oversize() {
    let ttf = asset(A);
    assert_eq!(ttf.info.family_name, "Studio Fixture");
    assert_eq!(ttf.info.style_name, "Regular");
    assert_eq!(ttf.info.format, "ttf");
    assert_eq!(asset(C).info.format, "otf");
    assert_ne!(ttf.info.sha256, asset(B).info.sha256);
    for bytes in [
        b"".as_slice(),
        b"ttcf\0\0\0\0",
        b"wOF2\0\0",
        &A[..24],
        b"OTTOthis is not a font",
    ] {
        assert_eq!(
            ReaderFontAsset::from_bytes(bytes.to_vec())
                .err()
                .unwrap()
                .code,
            "INVALID_FONT"
        );
    }
    assert_eq!(
        ReaderFontAsset::from_bytes(vec![0; MAX_FONT + 1])
            .err()
            .unwrap()
            .code,
        "TOO_LARGE"
    );
}

#[test]
fn same_bytes_deduplicate_same_names_stay_distinct_and_fonts_survive_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fonts.db");
    let db = Database::open(&path).unwrap();
    let one = db.import_reader_font(asset(A)).unwrap();
    let two = db.import_reader_font(asset(B)).unwrap();
    assert_eq!(one.family_name, two.family_name);
    assert_ne!(one.id, two.id);
    assert_eq!(db.import_reader_font(asset(A)).unwrap(), one);
    assert_eq!(db.reader_fonts().unwrap().len(), 2);
    drop(db);
    let db = Database::open(&path).unwrap();
    assert_eq!(db.reader_font(&one.id).unwrap().bytes, A);
    assert_eq!(db.reader_font(&two.id).unwrap().bytes, B);
    let json = serde_json::to_value(db.reader_fonts().unwrap())
        .unwrap()
        .to_string();
    assert!(!json.contains("bytes\"") && !json.contains("path\""));
    db.delete_reader_font(&two.id).unwrap();
    assert_eq!(
        db.reader_font(&two.id).err().unwrap().code,
        "FONT_NOT_FOUND"
    );
}

#[test]
fn reimport_repairs_damaged_bytes_without_breaking_project_font_identity() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("repair.db")).unwrap();
    let info = db.import_reader_font(asset(A)).unwrap();
    let mut p = project();
    p.reader.font_family = format!("font:{}", info.id);
    let p = db.create(p).unwrap();
    db.0.lock()
        .unwrap()
        .execute(
            "UPDATE reader_fonts SET bytes=? WHERE id=?",
            rusqlite::params![b"damaged".as_slice(), info.id],
        )
        .unwrap();
    assert_eq!(db.reader_font(&info.id).err().unwrap().code, "INVALID_FONT");
    assert_eq!(db.import_reader_font(asset(A)).unwrap(), info);
    assert_eq!(db.reader_font(&info.id).unwrap().bytes, A);
    assert_eq!(
        db.load(&p.id).unwrap().reader.font_family,
        p.reader.font_family
    );
    assert_eq!(db.reader_fonts().unwrap().len(), 1);
}

#[test]
fn project_and_trash_references_block_deletion_until_body_and_title_are_changed() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("refs.db")).unwrap();
    let a = db.import_reader_font(asset(A)).unwrap();
    let b = db.import_reader_font(asset(B)).unwrap();
    let mut p = project();
    p.reader.font_family = format!("font:{}", a.id);
    p.reader.title_style.font_family = format!("font:{}", b.id);
    let p = db.create(p).unwrap();
    let error = db.delete_reader_font(&a.id).unwrap_err();
    assert_eq!(error.code, "FONT_IN_USE");
    assert!(error.user_message.contains(&p.title));
    assert_eq!(
        db.delete_reader_font(&b.id).unwrap_err().code,
        "FONT_IN_USE"
    );
    let mut r = p.reader.clone();
    r.font_family = "SimSun".into();
    db.save_reader(&p.id, r.clone()).unwrap();
    db.delete_reader_font(&a.id).unwrap(); // overlay reader is authoritative, not stale projects.data.reader.
    db.trash(&p.id, true).unwrap();
    let error = db.delete_reader_font(&b.id).unwrap_err();
    assert!(error.user_message.contains("回收站"));
    db.trash(&p.id, false).unwrap();
    r.title_style.font_family = "inherit".into();
    db.save_reader(&p.id, r).unwrap();
    db.delete_reader_font(&b.id).unwrap();
    assert!(db.reader_fonts().unwrap().is_empty());
}

#[test]
fn missing_or_untrusted_family_never_replaces_saved_state() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("missing.db")).unwrap();
    let p = db.create(project()).unwrap();
    for family in [
        "https://example.invalid/font.ttf".to_string(),
        "C:/Windows/Fonts/x.ttf".into(),
        "font:../x".into(),
        format!("font:{}", id()),
    ] {
        let mut r = p.reader.clone();
        r.font_family = family.clone();
        let error = db.save_reader(&p.id, r).unwrap_err();
        assert_eq!(
            error.code,
            if family.starts_with("font:") && !family.contains("..") {
                "FONT_NOT_FOUND"
            } else {
                "VALIDATION"
            }
        );
        assert_eq!(
            db.load(&p.id).unwrap().reader.font_family,
            p.reader.font_family
        );
    }
    let mut p = project();
    p.reader.title_style.font_family = format!("font:{}", id());
    assert_eq!(db.create(p).unwrap_err().code, "FONT_NOT_FOUND");
}

#[test]
fn complete_backup_restores_font_bytes_and_original_text_anchors_into_empty_database() {
    let dir = tempfile::tempdir().unwrap();
    let source = Database::open(&dir.path().join("source.db")).unwrap();
    let font = asset(A);
    let mut p = project();
    p.reader.font_family = format!("font:{}", font.info.id);
    p.reader.title_style.font_family = format!("font:{}", font.info.id);
    let p = source
        .create_with_assets(p, &[], std::slice::from_ref(&font))
        .unwrap();
    let backup = dir.path().join("book.zip");
    files::export_package(&source, &p.id, &backup).unwrap();
    let imported = files::read_package(&backup).unwrap();
    let fonts = files::read_package_fonts(&backup, &imported).unwrap();
    assert_eq!(fonts.len(), 1);
    assert_eq!(fonts[0].bytes, A);
    let dest = Database::open(&dir.path().join("dest.db")).unwrap();
    let imported = dest.create_with_assets(imported, &[], &fonts).unwrap();
    assert_ne!(imported.chapters[0].id, p.chapters[0].id);
    assert_eq!(imported.reader.chapter_id, imported.chapters[0].id);
    assert_eq!(imported.reader.offset, 4);
    assert_eq!(dest.reader_font(&font.info.id).unwrap().bytes, A);
    assert_eq!(imported.chapters[0].working, p.chapters[0].working);
    let again = files::read_package(&backup).unwrap();
    dest.create_with_assets(again, &[], &fonts).unwrap();
    assert_eq!(dest.reader_fonts().unwrap().len(), 1);
}

#[test]
fn missing_corrupt_backup_fonts_and_conflicting_ids_fail_without_partial_assets() {
    let dir = tempfile::tempdir().unwrap();
    let source = Database::open(&dir.path().join("source.db")).unwrap();
    let a = asset(A);
    let mut p = project();
    p.reader.font_family = format!("font:{}", a.info.id);
    let p = source
        .create_with_assets(p, &[], std::slice::from_ref(&a))
        .unwrap();
    let backup = dir.path().join("good.zip");
    files::export_package(&source, &p.id, &backup).unwrap();
    for corrupt in [false, true] {
        let changed = dir.path().join(if corrupt {
            "corrupt.zip"
        } else {
            "missing.zip"
        });
        let mut archive = zip::ZipArchive::new(std::fs::File::open(&backup).unwrap()).unwrap();
        let mut out = zip::ZipWriter::new(std::fs::File::create(&changed).unwrap());
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).unwrap();
            let name = file.name().to_string();
            if name.starts_with("fonts/") && !corrupt {
                continue;
            }
            let mut data = Vec::new();
            file.read_to_end(&mut data).unwrap();
            if name.starts_with("fonts/") {
                data = b"not a font".to_vec();
            }
            out.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            out.write_all(&data).unwrap();
        }
        out.finish().unwrap();
        let p = files::read_package(&changed).unwrap();
        let error = files::read_package_fonts(&changed, &p).err().unwrap();
        assert_eq!(
            error.code,
            if corrupt {
                "INVALID_FONT"
            } else {
                "INVALID_PACKAGE"
            }
        );
    }
    let db = Database::open(&dir.path().join("conflict.db")).unwrap();
    db.import_reader_font(a.clone()).unwrap();
    let mut conflict = asset(B);
    conflict.info.id = a.info.id.clone();
    let fresh = asset(C);
    let mut p = project();
    p.reader.font_family = format!("font:{}", fresh.info.id);
    let error = db
        .create_with_assets(p, &[], &[fresh, conflict])
        .unwrap_err();
    assert_eq!(error.code, "FONT_CONFLICT");
    assert_eq!(db.reader_fonts().unwrap().len(), 1);
    assert_eq!(db.list_projects(false).unwrap().len(), 0);
}
