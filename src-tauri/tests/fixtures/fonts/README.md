# Original font test fixtures

These tiny fonts contain only a triangle at U+0041 and an empty .notdef glyph. They were generated for this application's tests from our own geometric coordinates; no system font or third-party glyph data is included. The fixture data may be used, modified, and redistributed without restriction.

fixture-a.ttf and fixture-b.ttf share a family name but have different outlines, to test identity and deduplication. fixture-c.otf uses CFF outlines. They are test assets, not reading fonts and do not contain Chinese glyphs.

Reproduction helper: workspace work/font-fixtures/build.py with fontTools 4.66.1; generated timestamps are fixed. fontTools is only a developer tool, not a runtime dependency.
