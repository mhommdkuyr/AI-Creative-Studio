# C++ Handwritten Answer Pages — Production Brief

## Deliverable
Create two separate portrait page images. Each page must contain 10 distinct C++ program answers, numbered 1–10 on each page (or continue numbering if the original question sheet requires it). The page itself must contain only the numbered C++ solutions—no Arabic explanations, headings, decorative labels, or generated UI.

## Source assets (private Google Drive; do not commit them to this public repository)
- Handwriting reference: `خط يدي .jpg`
- Question sheets: `IMG-20261017-WA0001.jpg`, `IMG-20261017-WA0002.jpg`, `IMG-20261017-WA0003.jpg`

Never copy these private reference images into this public repository. Supply them only to an authorized image-editing/generation service at execution time.

## Handwriting fidelity requirements
- Use the reference image as an actual visual reference input, not merely as a text prompt.
- Match the writer's letterforms, digit shapes, slant, spacing, baseline wobble, pen pressure, and ink color.
- Keep punctuation handwritten too: `;`, `:`, `{}`, `()`, `<<`, `>>`, quotes, and commas must not look typeset.
- Preserve natural variation. Avoid perfectly uniform strokes, monospaced typography, computer fonts, and vector-like glyph edges.
- Code must remain legible, with enough whitespace to distinguish braces and semicolons.
- Use realistic notebook/white-paper texture and a consistent camera angle; no fingers, phone UI, desk clutter, or watermark.

## Content correctness gate
Before rendering, transcribe and verify the 20 requested programs against the original question images. Do not invent or silently replace a question. Compile/test each solution where practical. Preserve C++ syntax exactly.

## Image QA checklist
- [ ] Exactly two distinct page images exist.
- [ ] Each page has 10 programs, with no duplicates.
- [ ] All code is C++ and matches the question sheet.
- [ ] Every brace, parenthesis, quote, operator, comma, and semicolon has been visually checked at full resolution.
- [ ] Digits and punctuation resemble the reference handwriting rather than a computer font.
- [ ] No Arabic text appears inside the generated pages.
- [ ] Both outputs have been opened and visually inspected before delivery.

## Execution notes
This brief is not itself a generated image and must never be presented as the final deliverable. A successful run must save both full-resolution page images as artifacts and include their exact artifact paths and QA results in the run summary.
