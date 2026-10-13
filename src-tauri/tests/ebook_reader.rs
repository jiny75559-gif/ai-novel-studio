use novel_studio_lib::{db::Database, ebooks::*, files::*, model::*, reader_marks::*, reading::*};
use std::path::Path;
#[test]
fn docx_keeps_heading_chapters_images_and_footnotes() {
    let (p, media) = import_docx(Path::new("tests/fixtures/illustrated.docx")).unwrap();
    assert_eq!(p.chapters.len(), 2);
    assert_eq!(media.len(), 1);
    assert_eq!(p.chapters[0].title, "第一章 港口");
    assert_eq!(p.book_content[0].images.len(), 1);
    assert_eq!(p.book_content[0].footnotes[0].label, "[1]");
    assert!(p.book_content[0].footnotes[0].text.contains("港口北侧"));
}

#[test]
fn epub_nav_and_ncx_preserve_nested_targets_images_and_footnotes() {
    for version in [2, 3] {
        let (p, assets) = import_epub(Path::new(&format!(
            "tests/fixtures/illustrated-epub{version}.epub"
        )))
        .unwrap();
        assert_eq!(p.chapters.len(), 2);
        assert_eq!(assets.len(), 1);
        assert_eq!(p.cover_image_id, assets[0].id);
        let volume = &p.book_outline[0];
        assert_eq!(volume.title, "第一卷");
        assert_eq!(volume.children.len(), 2);
        let nested = &volume.children[0].children[0];
        assert_eq!(nested.title, "第一章的小节");
        assert!(nested.offset > 0);
        assert_eq!(nested.chapter_id, p.chapters[0].id);
        let content = &p.book_content[0];
        assert_eq!(content.images.len(), 1);
        assert!(content.images[0].offset > 0);
        let note = &content.footnotes[0];
        assert_eq!(note.label, "[1]");
        assert!(note.text.contains("港口北侧"));
        let units = p.chapters[0].working.encode_utf16().collect::<Vec<_>>();
        assert_eq!(
            String::from_utf16(&units[note.start..note.end]).unwrap(),
            "[1]"
        );
        assert!(p.chapters[0].working.contains("琥珀星图"));
        assert!(p.chapters[0].working.contains("English — café 2026"));
        assert!(!p.chapters[0].working.contains("脚注内容"));
    }
}
#[test]
fn pdf_backup_keeps_original_bytes_page_marks_and_progress() {
    let folder = tempfile::tempdir().unwrap();
    let db = Database::open(&folder.path().join("one.db")).unwrap();
    let (mut p, pdf) = pdf_document(Path::new("tests/fixtures/illustrated.pdf")).unwrap();
    let original = pdf.bytes.clone();
    p.reader.offset = 4;
    p.reader.total_pages = 8;
    p.reading_marks.push(ReadingMark {
        quote: "PDF region".into(),
        note: "保留这张插图".into(),
        pdf_rects: vec![PdfRect {
            page: 5,
            x: 0.2,
            y: 0.3,
            width: 0.4,
            height: 0.2,
        }],
        ..ReadingMark::default()
    });
    p = db.create_with_media(p, &[pdf]).unwrap();
    let path = folder.path().join("backup.zip");
    export_package(&db, &p.id, &path).unwrap();
    let restored = read_package(&path).unwrap();
    assert_ne!(restored.id, p.id);
    assert_ne!(restored.reading_marks[0].id, p.reading_marks[0].id);
    assert_eq!(restored.reader.offset, 4);
    assert_eq!(
        restored.reading_marks[0].pdf_rects,
        p.reading_marks[0].pdf_rects
    );
    let assets = read_package_media(&path, &restored).unwrap();
    assert_eq!(assets[0].mime, "application/pdf");
    assert_eq!(assets[0].bytes, original);
    let other = Database::open(&folder.path().join("two.db")).unwrap();
    other.create_with_media(restored, &assets).unwrap();
}
#[test]
fn text_annotations_use_utf16_keep_author_edits_and_reject_stale_new_marks() {
    let mut p = document_project("测试", "txt", "😀风吹过港口。\n林遥走向灯塔。").unwrap();
    let mut m = ReadingMark {
        chapter_id: p.chapters[0].id.clone(),
        start: 2,
        end: 8,
        quote: "风吹过港口。".into(),
        ..ReadingMark::default()
    };
    upsert(&mut p, m.clone()).unwrap();
    assert!(current_quote(&p, &m));
    p.chapters[0].working = "正文已经改稿。".into();
    p.validate().unwrap();
    assert!(!current_quote(&p, &m));
    m.note = "批注继续保留".into();
    upsert(&mut p, m.clone()).unwrap();
    assert_eq!(p.reading_marks[0].note, m.note);
    m.id = id();
    assert_eq!(upsert(&mut p, m).unwrap_err().code, "SOURCE_CHANGED");
    assert!(export_notes(&p).contains("原文已修改"));
}
#[test]
fn page_progress_is_independent_of_manuscript_revision_and_survives_reopen() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("book.db");
    let db = Database::open(&path).unwrap();
    let p = db
        .create(
            document_project(
                "测试",
                "txt",
                "第一章\n正文足够长。\n第二章\n后面的文字。\n",
            )
            .unwrap(),
        )
        .unwrap();
    let mut reader = p.reader.clone();
    reader.chapter_id = p.chapters[1].id.clone();
    reader.offset = 3;
    reader.font_family = "SimSun".into();
    reader.page_margin = 52;
    reader.paragraph_spacing = 24;
    db.save_reader(&p.id, reader).unwrap();
    let loaded = db.load(&p.id).unwrap();
    assert_eq!(loaded.revision, p.revision);
    assert_eq!(
        loaded.chapters[0].versions[0].content,
        p.chapters[0].versions[0].content
    );
    assert!(progress(&loaded) > 0.5);
    drop(db);
    let db = Database::open(&path).unwrap();
    let restored = db.load(&p.id).unwrap();
    assert_eq!(restored.reader.offset, 3);
    assert_eq!(restored.reader.font_family, "SimSun");
    assert_eq!(restored.reader.paragraph_spacing, 24);
    assert_eq!(restored.reader.page_margin, 52);
}
#[test]
fn large_txt_thousands_of_chapters_and_single_long_section_keep_all_text() {
    let text = (1..=3000)
        .map(|i| format!("第{i}章 港口\n\n这一章保留中文与 English。\n"))
        .collect::<String>();
    let p = document_project("三千章", "txt", &text).unwrap();
    assert_eq!(p.chapters.len(), 3000);
    assert!(p.chapters[2999].working.contains("English"));
    let long = "（风仍吹着），她说：‘别回头。’\n".repeat(12000);
    let p = document_project("长章节", "txt", &long).unwrap();
    assert!(p.chapters.len() > 10);
    assert_eq!(
        p.chapters
            .iter()
            .map(|c| c.working.as_str())
            .collect::<String>(),
        long
    );
}
#[test]
fn invalid_pdf_and_out_of_bounds_annotations_are_rejected_atomically() {
    assert!(novel_studio_lib::visual::Media::from_pdf_bytes(b"not a PDF".to_vec()).is_err());
    let (mut p, _) = pdf_document(Path::new("tests/fixtures/illustrated.pdf")).unwrap();
    let m = ReadingMark {
        pdf_rects: vec![PdfRect {
            page: 1,
            x: 0.8,
            y: 0.0,
            width: 0.4,
            height: 0.1,
        }],
        ..ReadingMark::default()
    };
    assert!(upsert(&mut p, m).is_err());
    assert!(p.reading_marks.is_empty());
}
