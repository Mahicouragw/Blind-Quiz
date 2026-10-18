import { QUESTION_GROUPS_028_A } from './questions-028-a.js';
import { QUESTION_GROUPS_028_B } from './questions-028-b.js';
import { QUESTION_GROUPS_028_C } from './questions-028-c.js';
import { QUESTION_GROUPS_028_D } from './questions-028-d.js';
import { QUESTION_GROUPS_028_E } from './questions-028-e.js';
import { QUESTION_GROUPS_028_F } from './questions-028-f.js';

const questionGroups = [
  QUESTION_GROUPS_028_A,
  QUESTION_GROUPS_028_B,
  QUESTION_GROUPS_028_C,
  QUESTION_GROUPS_028_D,
  QUESTION_GROUPS_028_E,
  QUESTION_GROUPS_028_F,
];

export const EXPANSION_028_ROWS = questionGroups.flatMap(groups =>
  Object.entries(groups).flatMap(([category, questions]) =>
    questions.map(question => [category, ...question]),
  ),
);

export const CATEGORY_SOURCES_028 = {
  braille: "Braille Authority of North America (BANA), UEB and Nemeth codebooks, Music Braille Code, tactile-graphics manual, and slate-and-stylus guidance — https://www.brailleauthority.org/ueb/abcs/abcs-ueb.html ; https://www.brailleauthority.org/nemeth-code ; https://brailleauthority.org/music-braille-code ; https://www.brailleauthority.org/tg/web-manual/tgmanual.html ; https://www.brailleauthority.org/slatestylus/slate.pdf ; American Printing House, Refreshabraille user guide (cursor routing and display controls) — https://tech.aph.org/rbd_doc.htm ; Unicode Braille Patterns chart — https://www.unicode.org/charts/PDF/U2800.pdf",
  technology: "NIST Computer Security Resource Center glossary — https://csrc.nist.gov/glossary ; MDN Web Docs — https://developer.mozilla.org/ ; IETF TLS 1.3 specification, RFC 8446 — https://www.rfc-editor.org/rfc/rfc8446 ; W3C WAI, Understanding Focus Visible — https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html ; Encyclopaedia Britannica, Computer — https://www.britannica.com/technology/computer",
  sports: "Official rules and references: IFAB, ICC, BWF, FIBA, World Athletics, FIVB, International Fencing Federation, and World Archery — https://www.theifab.com/laws/ ; https://www.icc-cricket.com/about/cricket/rules-and-regulations ; https://corporate.bwfbadminton.com/statutes/ ; https://www.fiba.basketball/documents ; https://worldathletics.org/about-iaaf/documents/book-of-rules ; https://www.fivb.com/volleyball/the-game/official-volleyball-rules/ ; https://fie.org/fie/documents/rules ; https://www.worldarchery.sport/rules",
  abbreviations: "United Nations Editorial Manual, official abbreviations — https://www.un.org/dgacm/en/content/editorial-manual/abbreviations ; United Nations system — https://www.un.org/en/about-us/un-system ; MDN Web Docs — https://developer.mozilla.org/en-US/docs/Web/HTML ; NIST CSRC Glossary — https://csrc.nist.gov/glossary ; NIST Digital Identity Guidelines (MFA) — https://pages.nist.gov/800-63-4/sp800-63.html ; NATO — https://www.nato.int/cps/en/natohq/what_is_nato.htm ; IMF, GDP — https://www.imf.org/external/pubs/ft/fandd/basics/gdp.htm ; MedlinePlus, MRI — https://medlineplus.gov/mriscans.html ; NASA — https://www.nasa.gov/ ; ISRO — https://www.isro.gov.in/ ; NPCI, UPI — https://www.npci.org.in/what-we-do/upi/product-overview ; GST Portal — https://www.gst.gov.in/ ; IETF RFC 4180 (CSV) — https://www.rfc-editor.org/rfc/rfc4180 ; 3GPP (LTE) — https://www.3gpp.org/lte ; DRDO — https://www.drdo.gov.in/ ; International Atomic Energy Agency — https://www.iaea.org/about/overview ; WIPO — https://www.wipo.int/about-wipo/en/ ; OPEC — https://www.opec.org/ ; UNCTAD, Investment — https://unctad.org/topic/investment ; NIST OCR reference, via GovInfo — https://www.govinfo.gov/app/details/GOVPUB-C13-6a49c5e8f6322cac7775b339001b71c9",
};
