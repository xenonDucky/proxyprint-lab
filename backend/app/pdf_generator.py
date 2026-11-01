"""Pure Python, Standards-Compliant PDF 1.4 Sheet Generator.
Builds exact 3x3 MTG proxy print sheets with vector cutting guides (0.265mm)
and mathematically lossless FlateDecode image compression.
"""

import io
import math
import zlib
from typing import List, Tuple, Dict, Any
import numpy as np
from PIL import Image

MM_TO_PT = 72.0 / 25.4

PAPER_DIMENSIONS_PT: Dict[str, Tuple[float, float]] = {
    "letter": (8.5 * 72.0, 11.0 * 72.0),  # 612.0 x 792.0 pt
    "a4": (210.0 * MM_TO_PT, 297.0 * MM_TO_PT),  # ~595.28 x ~841.89 pt
}


def create_3x3_pdf_sheet(
    card_rgb_list: List[np.ndarray],
    paper_size: str = "letter",
    card_width_mm: float = 63.0,
    card_height_mm: float = 88.0,
    guide_width_mm: float = 0.265,
    guide_color_rgb: Tuple[float, float, float] = (0.0, 0.0, 0.0),
    show_guides: bool = True,
    extend_guides_to_edge: bool = True,
) -> bytes:
    """
    Generate a complete, valid ISO 32000-1 / PDF 1.4 file containing 9 cards per page
    in a centered 3x3 grid with vector cut guides.
    """
    paper_w_pt, paper_h_pt = PAPER_DIMENSIONS_PT.get(paper_size.lower(), PAPER_DIMENSIONS_PT["letter"])

    card_w_pt = card_width_mm * MM_TO_PT
    card_h_pt = card_height_mm * MM_TO_PT
    guide_w_pt = max(0.1, guide_width_mm * MM_TO_PT)

    grid_w_pt = 3.0 * card_w_pt
    grid_h_pt = 3.0 * card_h_pt

    margin_x_pt = max(0.0, (paper_w_pt - grid_w_pt) / 2.0)
    margin_y_pt = max(0.0, (paper_h_pt - grid_h_pt) / 2.0)

    total_cards = max(1, len(card_rgb_list))
    total_pages = math.ceil(total_cards / 9)

    parts: List[bytes] = []
    offsets: List[int] = []
    cur_offset = 0

    def write_chunk(chunk: bytes):
        nonlocal cur_offset
        parts.append(chunk)
        cur_offset += len(chunk)

    def write_str(s: str):
        write_chunk(s.encode("latin1"))

    # PDF Header
    write_str("%PDF-1.4\n%âãÏÓ\n")

    catalog_id = 1
    pages_id = 2
    next_obj_id = 3

    page_obj_ids = [next_obj_id + i for i in range(total_pages)]
    next_obj_id += total_pages

    # Compress card images and assign object IDs
    image_info_list = []
    for rgb in card_rgb_list:
        h, w, _ = rgb.shape
        raw_bytes = rgb.tobytes()
        comp = zlib.compress(raw_bytes, level=6)
        obj_id = next_obj_id
        next_obj_id += 1
        image_info_list.append({
            "obj_id": obj_id,
            "w": w,
            "h": h,
            "comp_data": comp,
        })

    # Catalog
    offsets.append(cur_offset)
    write_str(f"{catalog_id} 0 obj\n<< /Type /Catalog /Pages {pages_id} 0 R >>\nendobj\n")

    # Pages
    offsets.append(cur_offset)
    kids = " ".join(f"{pid} 0 R" for pid in page_obj_ids)
    write_str(f"{pages_id} 0 obj\n<< /Type /Pages /Kids [{kids}] /Count {total_pages} >>\nendobj\n")

    # Pages and Page Contents
    for p in range(total_pages):
        page_obj_id = page_obj_ids[p]
        contents_id = next_obj_id
        next_obj_id += 1

        start_idx = p * 9
        page_imgs = image_info_list[start_idx : start_idx + 9]

        xobjects_entries = []
        content_stream_parts = []

        for slot, img_info in enumerate(page_imgs):
            res_name = f"Im{slot}"
            xobjects_entries.append(f"/{res_name} {img_info['obj_id']} 0 R")

            col = slot % 3
            row = slot // 3  # 0 (top), 1 (middle), 2 (bottom)

            card_x = margin_x_pt + col * card_w_pt
            # In PDF Y=0 is at bottom, so row 0 is at top
            card_y = margin_y_pt + (2 - row) * card_h_pt

            content_stream_parts.append(
                f"q\n{card_w_pt:.4f} 0 0 {card_h_pt:.4f} {card_x:.4f} {card_y:.4f} cm\n/{res_name} Do\nQ\n"
            )

        if show_guides:
            gr, gg, gb = guide_color_rgb
            content_stream_parts.append("q\n")
            content_stream_parts.append(f"{guide_w_pt:.4f} w\n")
            content_stream_parts.append(f"{gr:.3f} {gg:.3f} {gb:.3f} RG\n")

            x_coords = [margin_x_pt + i * card_w_pt for i in range(4)]
            y_coords = [margin_y_pt + i * card_h_pt for i in range(4)]

            for vx in x_coords:
                if extend_guides_to_edge:
                    content_stream_parts.append(f"{vx:.4f} 0 m {vx:.4f} {paper_h_pt:.4f} l S\n")
                else:
                    tick = 5.0 * MM_TO_PT
                    content_stream_parts.append(
                        f"{vx:.4f} {(y_coords[0] - tick):.4f} m {vx:.4f} {(y_coords[3] + tick):.4f} l S\n"
                    )

            for hy in y_coords:
                if extend_guides_to_edge:
                    content_stream_parts.append(f"0 {hy:.4f} m {paper_w_pt:.4f} {hy:.4f} l S\n")
                else:
                    tick = 5.0 * MM_TO_PT
                    content_stream_parts.append(
                        f"{(x_coords[0] - tick):.4f} {hy:.4f} m {(x_coords[3] + tick):.4f} {hy:.4f} l S\n"
                    )

            content_stream_parts.append("Q\n")

        # Page Object
        offsets.append(cur_offset)
        xobj_dict = " ".join(xobjects_entries)
        write_str(
            f"{page_obj_id} 0 obj\n<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {paper_w_pt:.2f} {paper_h_pt:.2f}] /Resources << /ProcSet [/PDF /ImageC] /XObject << {xobj_dict} >> >> /Contents {contents_id} 0 R >>\nendobj\n"
        )

        # Content Stream Object
        full_content = "".join(content_stream_parts).encode("latin1")
        offsets.append(cur_offset)
        write_str(f"{contents_id} 0 obj\n<< /Length {len(full_content)} >>\nstream\n")
        write_chunk(full_content)
        write_str("endstream\nendobj\n")

    # Image Objects
    for img_info in image_info_list:
        offsets.append(cur_offset)
        write_str(
            f"{img_info['obj_id']} 0 obj\n<< /Type /XObject /Subtype /Image /Width {img_info['w']} /Height {img_info['h']} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length {len(img_info['comp_data'])} >>\nstream\n"
        )
        write_chunk(img_info["comp_data"])
        write_str("\nendstream\nendobj\n")

    # Xref Table
    start_xref = cur_offset
    total_objects = next_obj_id
    write_str(f"xref\n0 {total_objects}\n0000000000 65535 f \n")
    for off in offsets:
        write_str(f"{off:010d} 00000 n \n")

    # Trailer
    write_str(f"trailer\n<< /Size {total_objects} /Root {catalog_id} 0 R >>\nstartxref\n{start_xref}\n%%EOF\n")

    return b"".join(parts)
