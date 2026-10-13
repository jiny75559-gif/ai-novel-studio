use crate::model::*;

#[derive(Clone, Copy)]
struct State {
    ignored: bool,
    uc: usize,
    codepage: u16,
}
fn flush(bytes: &mut Vec<u8>, output: &mut Vec<u16>, state: State) -> Result<()> {
    if state.ignored {
        bytes.clear();
        return Ok(());
    }
    let label = match state.codepage {
        65001 => "utf-8".to_string(),
        936 => "gb18030".into(),
        950 => "big5".into(),
        932 => "shift_jis".into(),
        949 => "euc-kr".into(),
        n => format!("windows-{n}"),
    };
    let codec = encoding_rs::Encoding::for_label(label.as_bytes())
        .ok_or_else(|| AppError::new("INVALID_ENCODING", "RTF 使用了未支持的字符编码。"))?;
    let (text, _, errors) = codec.decode(bytes);
    if errors {
        return Err(AppError::new(
            "INVALID_ENCODING",
            "RTF 字符编码不完整或无效。",
        ));
    }
    output.extend(text.encode_utf16());
    bytes.clear();
    Ok(())
}
pub fn parse(input: &[u8]) -> Result<String> {
    if !input.starts_with(b"{\\rtf") {
        return Err(AppError::new("INVALID_DOCUMENT", "不是有效 RTF 文档。"));
    }
    let mut stack = vec![];
    let mut state = State {
        ignored: false,
        uc: 1,
        codepage: 1252,
    };
    let (mut output, mut bytes) = (vec![], vec![]);
    let (mut pos, mut skip) = (0, 0usize);
    while pos < input.len() {
        let b = input[pos];
        pos += 1;
        match b {
            b'{' => {
                flush(&mut bytes, &mut output, state)?;
                stack.push(state);
                if stack.len() > 256 {
                    return Err(AppError::new("INVALID_DOCUMENT", "RTF 层级过深。"));
                }
            }
            b'}' => {
                flush(&mut bytes, &mut output, state)?;
                state = stack
                    .pop()
                    .ok_or_else(|| AppError::new("INVALID_DOCUMENT", "RTF 括号不匹配。"))?;
            }
            b'\\' => {
                let Some(&symbol) = input.get(pos) else {
                    return Err(AppError::new("INVALID_DOCUMENT", "RTF 控制符不完整。"));
                };
                pos += 1;
                if b"\\{}~-_".contains(&symbol) {
                    if skip > 0 {
                        skip -= 1;
                        continue;
                    }
                    if !state.ignored {
                        flush(&mut bytes, &mut output, state)?;
                        output.push(match symbol {
                            b'~' => 0xa0,
                            b'-' => 0xad,
                            b'_' => 0x2011,
                            _ => symbol as u16,
                        });
                    }
                    continue;
                }
                if symbol == b'\'' {
                    let code = input
                        .get(pos..pos + 2)
                        .and_then(|s| std::str::from_utf8(s).ok())
                        .and_then(|s| u8::from_str_radix(s, 16).ok())
                        .ok_or_else(|| {
                            AppError::new("INVALID_DOCUMENT", "RTF 十六进制转义无效。")
                        })?;
                    pos += 2;
                    if skip > 0 {
                        skip -= 1;
                    } else if !state.ignored {
                        bytes.push(code);
                    }
                    continue;
                }
                if symbol == b'*' {
                    flush(&mut bytes, &mut output, state)?;
                    state.ignored = true;
                    continue;
                }
                if !symbol.is_ascii_alphabetic() {
                    continue;
                }
                let begin = pos - 1;
                while input.get(pos).is_some_and(u8::is_ascii_alphabetic) {
                    pos += 1;
                }
                let word = std::str::from_utf8(&input[begin..pos]).unwrap_or("");
                let number_start = pos;
                if input.get(pos) == Some(&b'-') {
                    pos += 1;
                }
                while input.get(pos).is_some_and(u8::is_ascii_digit) {
                    pos += 1;
                }
                let number = std::str::from_utf8(&input[number_start..pos])
                    .ok()
                    .and_then(|s| s.parse::<i32>().ok());
                if input.get(pos) == Some(&b' ') {
                    pos += 1;
                }
                if word == "bin" {
                    let len = number
                        .filter(|n| *n >= 0)
                        .ok_or_else(|| AppError::new("INVALID_DOCUMENT", "RTF 二进制长度无效。"))?
                        as usize;
                    pos = pos
                        .checked_add(len)
                        .filter(|end| *end <= input.len())
                        .ok_or_else(|| AppError::new("INVALID_DOCUMENT", "RTF 二进制内容截断。"))?;
                    continue;
                }
                if [
                    "fonttbl",
                    "colortbl",
                    "stylesheet",
                    "info",
                    "pict",
                    "object",
                    "header",
                    "footer",
                    "headerl",
                    "headerr",
                    "footerl",
                    "footerr",
                    "filetbl",
                    "fldinst",
                    "datastore",
                    "xmlopen",
                    "xmlclose",
                ]
                .contains(&word)
                {
                    flush(&mut bytes, &mut output, state)?;
                    state.ignored = true;
                    continue;
                }
                if state.ignored {
                    continue;
                }
                match word {
                    "ansicpg" => {
                        flush(&mut bytes, &mut output, state)?;
                        state.codepage = number
                            .and_then(|n| u16::try_from(n).ok())
                            .ok_or_else(|| AppError::new("INVALID_ENCODING", "RTF 代码页无效。"))?;
                    }
                    "uc" => {
                        state.uc = number.filter(|n| (0..=16).contains(n)).ok_or_else(|| {
                            AppError::new("INVALID_DOCUMENT", "RTF Unicode 回退长度无效。")
                        })? as usize;
                    }
                    "u" => {
                        flush(&mut bytes, &mut output, state)?;
                        let code =
                            number
                                .filter(|n| (-32768..=65535).contains(n))
                                .ok_or_else(|| {
                                    AppError::new("INVALID_DOCUMENT", "RTF Unicode 字符无效。")
                                })?;
                        output.push(code as u16);
                        skip = state.uc;
                    }
                    "par" | "line" | "tab" | "emdash" | "endash" | "lquote" | "rquote"
                    | "ldblquote" | "rdblquote" | "bullet" => {
                        flush(&mut bytes, &mut output, state)?;
                        let text = match word {
                            "par" => "\n\n",
                            "line" => "\n",
                            "tab" => "\t",
                            "emdash" => "—",
                            "endash" => "–",
                            "lquote" => "‘",
                            "rquote" => "’",
                            "ldblquote" => "“",
                            "rdblquote" => "”",
                            _ => "•",
                        };
                        output.extend(text.encode_utf16());
                    }
                    _ => {}
                }
            }
            b'\n' | b'\r' => {}
            _ if skip > 0 => {
                skip -= 1;
            }
            _ if !state.ignored => bytes.push(b),
            _ => {}
        }
        if output.len() > 50 * 1024 * 1024 {
            return Err(AppError::new("TOO_LARGE", "RTF 正文超过上限。"));
        }
    }
    flush(&mut bytes, &mut output, state)?;
    if !stack.is_empty() {
        return Err(AppError::new("INVALID_DOCUMENT", "RTF 文档未闭合。"));
    }
    String::from_utf16(&output)
        .map_err(|_| AppError::new("INVALID_ENCODING", "RTF Unicode 字符不完整。"))
}
