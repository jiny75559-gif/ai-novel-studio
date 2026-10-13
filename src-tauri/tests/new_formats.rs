use base64::{engine::general_purpose::STANDARD, Engine};
use novel_studio_lib::{ebooks::import_extra, model::*};
use std::{io::Write, path::Path};
fn picture(path: &Path) -> Vec<u8> {
    image::RgbImage::from_pixel(24, 24, image::Rgb([210, 30, 60]))
        .save(path)
        .unwrap();
    std::fs::read(path).unwrap()
}
fn zip(path: &Path, files: &[(&str, &[u8])]) {
    let mut z = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    for (name, bytes) in files {
        z.start_file(*name, zip::write::SimpleFileOptions::default())
            .unwrap();
        z.write_all(bytes).unwrap();
    }
    z.finish().unwrap();
}
fn all_text(p: &Project) -> String {
    p.chapters.iter().map(|c| c.working.as_str()).collect()
}
#[test]
fn html_real_world_markup_images_notes_and_external_resources() {
    let dir = tempfile::tempdir().unwrap();
    picture(&dir.path().join("image.png"));
    let path = dir.path().join("book.HTML");
    std::fs::write(&path, "<!DOCTYPE html><title>中文网页书</title><h1>第一章 雨夜</h1><p>前文😀<img src='image.png'><h2>小节</h2><p>后文<a href='#n'>[1]</a><aside id='n' role='doc-footnote'>脚注说明</aside><script>不要执行</script><iframe>不要显示</iframe><img src='https://example.com/a.png'><img src='../outside.png'>").unwrap();
    let (p, media) = import_extra(&path).unwrap();
    assert_eq!(p.title, "中文网页书");
    assert_eq!(media.len(), 1);
    let text = all_text(&p);
    assert!(text.contains("前文😀"));
    assert!(text.contains("后文"));
    assert!(!text.contains("不要执行") && !text.contains("不要显示") && !text.contains("脚注说明"));
    assert_eq!(p.book_outline[0].children[0].title, "小节");
    let note = &p.book_content[0].footnotes[0];
    let utf16: Vec<_> = p.chapters[0].working.encode_utf16().collect();
    assert_eq!(
        String::from_utf16(&utf16[note.start..note.end]).unwrap(),
        "[1]"
    );
    assert_eq!(note.text, "脚注说明");
    assert!(!p.cover_image_id.is_empty());
}
#[test]
fn fb2_plain_and_packed_keep_nested_sections_images_and_notes() {
    let dir = tempfile::tempdir().unwrap();
    let png = picture(&dir.path().join("cover.png"));
    let text = format!(
        r##"<?xml version="1.0" encoding="UTF-8"?><FictionBook xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><book-title>FB2 中文故事</book-title></title-info></description><body><section><title><p>第一章</p></title><p>中文正文😀<a type="note" l:href="#n1">[1]</a></p><image l:href="#cover"/><section><title><p>第二级目录</p></title><p>故事继续。</p></section></section></body><body name="notes"><section id="n1"><p>脚注解释</p></section></body><binary id="cover" content-type="image/png">{}</binary></FictionBook>"##,
        STANDARD.encode(png)
    );
    let plain = dir.path().join("novel.fb2");
    std::fs::write(&plain, &text).unwrap();
    let packed = dir.path().join("novel.fb2.zip");
    zip(&packed, &[("novel.fb2", text.as_bytes())]);
    for path in [&plain, &packed] {
        let (p, m) = import_extra(path).unwrap();
        assert_eq!(p.title, "FB2 中文故事");
        assert_eq!(m.len(), 1);
        assert!(all_text(&p).contains("中文正文😀"));
        assert!(!all_text(&p).contains("脚注解释"));
        assert_eq!(p.book_outline[0].children[0].title, "第二级目录");
        assert_eq!(p.book_content[0].footnotes[0].text, "脚注解释");
        assert_eq!(p.book_content[0].images.len(), 1);
    }
}
#[test]
fn odt_keeps_headings_spaces_picture_and_inline_footnote() {
    let dir = tempfile::tempdir().unwrap();
    let png = picture(&dir.path().join("img.png"));
    let path = dir.path().join("book.odt");
    let xml = r#"<office:document-content xmlns:office="o" xmlns:text="t" xmlns:draw="d" xmlns:xlink="x"><office:body><office:text><text:h text:outline-level="1">第一章 雾</text:h><text:p>正文😀<text:s text:c="3"/>继续<text:note><text:note-citation>1</text:note-citation><text:note-body><text:p>ODT 脚注</text:p></text:note-body></text:note><draw:frame><draw:image xlink:href="Pictures/img.png"/></draw:frame></text:p><text:h text:outline-level="2">小节</text:h><text:p>结束。</text:p></office:text></office:body></office:document-content>"#;
    zip(
        &path,
        &[
            ("mimetype", b"application/vnd.oasis.opendocument.text"),
            ("content.xml", xml.as_bytes()),
            ("Pictures/img.png", &png),
        ],
    );
    let (p, m) = import_extra(&path).unwrap();
    assert_eq!(m.len(), 1);
    assert!(all_text(&p).contains("正文😀   继续1"));
    assert_eq!(p.book_outline[0].children[0].title, "小节");
    assert_eq!(p.book_content[0].footnotes[0].text, "ODT 脚注");
    assert!(!all_text(&p).contains("ODT 脚注"));
    assert_eq!(p.book_content[0].images.len(), 1);
}
#[test]
fn rtf_unicode_surrogates_legacy_chinese_groups_and_fallback() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("book.rtf");
    std::fs::write(&path, r"{\rtf1\ansi\ansicpg936{\fonttbl ignored}\u20013?\u25991?\par \'d6\'d0\'ce\'c4 {\b \u27491?\u25991?}\uc0\u-10179\u-8704{\*\unknown hidden}{\pict 00001111}\par end}").unwrap();
    let (p, m) = import_extra(&path).unwrap();
    assert!(m.is_empty());
    let text = all_text(&p);
    assert!(text.contains("中文"));
    assert!(text.contains('😀'));
    assert!(!text.contains("ignored") && !text.contains("hidden") && !text.contains("00001111"));
    std::fs::write(&path, r"{\rtf1\ansi incomplete").unwrap();
    assert_eq!(import_extra(&path).err().unwrap().code, "INVALID_DOCUMENT");
}
#[test]
fn cbz_natural_page_order_image_only_and_unsafe_archives() {
    let dir = tempfile::tempdir().unwrap();
    let png = picture(&dir.path().join("page.png"));
    let path = dir.path().join("book.cbz");
    zip(&path, &[("10.png", &png), ("2.png", &png), ("1.png", &png)]);
    let (p, m) = import_extra(&path).unwrap();
    assert_eq!(m.len(), 3);
    assert_eq!(p.chapters.len(), 3);
    assert!(p.chapters[0].title.ends_with("1.png"));
    assert!(p.chapters[1].title.ends_with("2.png"));
    assert!(p.chapters[2].title.ends_with("10.png"));
    assert!(p.chapters.iter().all(|c| c.working.is_empty()));
    assert_eq!(p.book_content[0].images.len(), 1);
    let mut last = p.clone();
    last.reader.chapter_id = last.chapters[2].id.clone();
    assert_eq!(novel_studio_lib::reading::progress(&last), 1.0);
    zip(&path, &[("../escape.png", &png)]);
    assert_eq!(import_extra(&path).err().unwrap().code, "INVALID_DOCUMENT");
}
#[test]
fn long_html_preserves_all_text_and_rejects_excessive_depth() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("long.html");
    let body = "<p>完整保留中文😀和 English。</p>".repeat(15000);
    std::fs::write(&path, &body).unwrap();
    let (p, _) = import_extra(&path).unwrap();
    let text = all_text(&p);
    assert_eq!(text.matches("完整保留中文😀和 English。").count(), 15000);
    assert!(p.chapters.len() > 1);
    std::fs::write(
        &path,
        format!("{}x{}", "<div>".repeat(140), "</div>".repeat(140)),
    )
    .unwrap();
    assert!(import_extra(&path).is_err());
}
