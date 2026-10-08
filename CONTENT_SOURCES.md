# Question-content provenance and review status

## Status

The repository contains 325 questions: 73 historical starter questions and 252 Migration 009 questions added on 3 October 2026. The live database was separately verified to contain 114 rows and to use IDs through `bq-en-0414`; therefore Migration 009 uses `bq-en-0415`–`bq-en-0666`. It contributes 12 questions to every category plus 12 additional Telugu/Bharati Braille vowel questions. Each added row has four unique choices, one declared correct answer, an explanation, category/subcategory, difficulty, tags, stable ID, and a category-level source note stored in the question and migration row.

The added questions were manually checked for consistency against the references below and passed automated structural and duplicate validation. This is an internal editorial review, **not independent expert fact-checking**. The original 73 questions still carry “editorial review recommended” source notes. Time-sensitive facts and rules should be rechecked before a production content release.

## References used for Migration 009

- **Animals:** Smithsonian’s National Zoo animal fact sheets — https://nationalzoo.si.edu/animals
- **Birds:** Cornell Lab of Ornithology, All About Birds — https://www.allaboutbirds.org/guide/
- **Nature:** USGS Water Science School — https://www.usgs.gov/special-topics/water-science-school ; NASA Earth Science — https://science.nasa.gov/earth/
- **Musical instruments:** Encyclopaedia Britannica, “Musical instrument” — https://www.britannica.com/art/musical-instrument
- **Science:** NASA Science — https://science.nasa.gov/ ; NIST SI Units — https://www.nist.gov/pml/owm/si-units
- **Geography and history:** Encyclopaedia Britannica topic collections — https://www.britannica.com/browse/Geography-Travel ; https://www.britannica.com/browse/History-Society
- **India and civics:** National Portal of India — https://www.india.gov.in/ ; Legislative Department, Constitution of India — https://legislative.gov.in/constitution-of-india/ ; UN Universal Declaration of Human Rights — https://www.ohchr.org/en/human-rights/universal-declaration/translations/english
- **Technology and accessibility:** NIST CSRC glossary — https://csrc.nist.gov/glossary ; MDN Web Docs — https://developer.mozilla.org/
- **Sports rules:** IFAB — https://www.theifab.com/laws/ ; ICC — https://www.icc-cricket.com/about/cricket/rules-and-regulations ; BWF — https://corporate.bwfbadminton.com/statutes/ ; FIBA — https://www.fiba.basketball/documents ; World Athletics — https://worldathletics.org/about-iaaf/documents/book-of-rules ; FIVB — https://www.fivb.com/volleyball/the-game/official-volleyball-rules/
- **Economics and commerce:** IMF Back to Basics — https://www.imf.org/external/pubs/ft/fandd/basics/ ; WTO glossary — https://www.wto.org/english/thewto_e/glossary_e/glossary_e.htm ; International Trade Centre SME Trade Academy — https://learning.intracen.org/
- **Music theory:** Open Music Theory — https://viva.pressbooks.pub/openmusictheory/
- **Abbreviations:** official organization/standards pages, with UN-system index — https://www.un.org/en/about-us/un-system
- **Vocabulary:** Merriam-Webster Dictionary — https://www.merriam-webster.com/
- **Braille:** Braille Authority of North America, *The ABCs of UEB* — https://www.brailleauthority.org/ueb/abcs/abcs-ueb.html ; Perkins School for the Blind, “How the braille alphabet works” — https://www.perkins.org/how-the-braille-alphabet-works/ ; Government of India/NIEPVD, *Standard Bharati Braille Codes* — https://cdnbbsr.s3waas.gov.in/s36ee69d3769e832ec77c9584e0b7ba112/uploads/2025/01/20250104954295710.pdf
- **Management:** ISO 21502 overview — https://www.iso.org/standard/74947.html ; UK Government Project Delivery Functional Standard — https://www.gov.uk/government/publications/project-delivery-functional-standard
- **Business:** US Small Business Administration, Business Guide — https://www.sba.gov/business-guide
- **Accounting:** IFRS Foundation issued standards — https://www.ifrs.org/issued-standards/list-of-standards/ ; IAASB standards — https://www.iaasb.org/publications

## Editorial cautions

Category-level sources support broad review but do not prove each sentence independently. An expert reviewer should still examine specialized claims, India civics/history items, sports rules, and accounting terminology before labeling the full bank independently fact-checked. Question reports from players should be triaged against the canonical database row.

## Audio

See `AUDIO_LICENSES.md`. No third-party recordings, generated effects, or music are bundled.

## Migration 010 (bq-en-0667 to bq-en-0866)

200 additional questions, 10 in each of the 20 categories, authored in the same row format and checked against the same category references listed above (each row's `sourceNote` is the category reference with an https URL). Every prompt was checked against the existing 325 prompts (normalized, case- and punctuation-insensitive) for duplicates; `tests/smoke.mjs` enforces no duplicate prompts across all 525 questions.

## Migration 011 (bq-en-0867 to bq-en-1066)

200 more questions, 10 in each of the 20 categories, in the same row format with the same category references (https URLs). Every prompt was checked against all 525 earlier prompts for duplicates; `tests/smoke.mjs` enforces no duplicate prompts across all 725 questions.

## Migration 015 (bq-en-1067 to bq-en-1166)

100 questions in five new categories, 20 each: Medical, Math, Physics, Chemistry and Biology. Same row format; every row's `sourceNote` names its reference (MedlinePlus and WHO fact sheets; OpenStax Prealgebra, Elementary Algebra, College Physics, Chemistry 2e and Biology 2e; NIST SI units; IUPAC periodic table). Every prompt was checked against all 725 earlier questions: no repeated prompts, and questions that would repeat a fact already asked in Science or Nature were replaced. Each question has 4 unique options including exactly one correct answer, and the game shuffles option positions every round.

## Word meanings (Letters to Words)
After a word is found, the game says and shows a short meaning. The meanings come from **Princeton WordNet 3.1** (WordNet License: free to use, copy and redistribute with its notice, which ships in `assets/meanings/LICENSE.txt`). They are extracted by `scripts/build-meanings.mjs` (`npm run meanings`):
- the most-used sense is chosen
- proper-noun and abbreviation senses are skipped
- forms like SEES or RAN use the base word's meaning
- common little words (IS, THE, HE…) have hand-written meanings

The meanings are bundled with the game in files split by first letter, so they work offline and no word or player data is sent to any dictionary service.
