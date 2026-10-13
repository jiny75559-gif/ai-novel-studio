"""Prepare local fixture files for the desktop QA scripts, never model output."""
import pathlib
import struct
import zlib

directory = pathlib.Path("../../work/qa-v02")
directory.mkdir(parents=True, exist_ok=True)


def chunk(kind, data):
    return (struct.pack("!I", len(data)) + kind + data
            + struct.pack("!I", zlib.crc32(kind + data) & 0xffffffff))


width, height = 240, 320
raw = b"".join(b"\0" + b"".join(
    bytes((max(30, 80 + y // 4), max(60, 110 + y // 6), max(70, 135 - y // 5), 255))
    for _ in range(width)) for y in range(height))
png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack("!IIBBBBB", width, height, 8, 6, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
(directory / "image-fixture.png").write_bytes(png)
paragraphs = [
    "雨沿着灯塔的石阶流下。林舟护着受伤的左臂，停在门口。叶岚把铜钥匙藏进外套，侧身让他进来。",
    "屋里只有一盏油灯。火光在墙上缓慢移动，将两个人的影子拉长。海浪拍击堤岸，声音隔着雾传来。",
    "他没有追问钥匙的去向。叶岚坐在窗边，拆开一封迟到了三年的信。信纸已经泛黄，折痕处留下细小的裂口。",
    "夜还很长。他们决定等潮水退去，再沿旧路返回城里。门外的风忽然停了，只剩灯芯轻轻作响。",
]
text = ("第一章 灯下\n" + "\n\n".join(paragraphs * 12)
        + "\n第二章 远行\n天亮以后，他们沿着石阶离开灯塔。\n\n第三章 尾声\n旧门静静合上。\n")
(directory / "离线阅读测试.txt").write_text(text, encoding="utf-8")
print("Prepared fixture files in", directory.resolve())
