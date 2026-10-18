/**
 * @file generate-sample-data.js
 * @notice Generates valid synthetic sample files for MediConsent hackathon demo.
 * ALL DATA IS SYNTHETIC AND ARTIFICIAL — NOT REAL PATIENT DATA.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUTPUT_DIR = path.resolve(__dirname, "../docs/sample-data");
const TAMPER_DIR = path.resolve(OUTPUT_DIR, "tamper_test");

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(TAMPER_DIR, { recursive: true });

// ── Minimal Valid PDF Generator ──────────────────────────────────────────────
function createPdf(title, lines) {
  let contentStream = "BT /F1 16 Tf 50 720 Td (" + title + ") Tj ET\n";
  contentStream += "BT /F1 10 Tf 50 700 Td (SAMPLE DATA - NOT REAL MEDICAL RECORD - SYNTHETIC DEMO ONLY) Tj ET\n";
  contentStream += "BT /F1 10 Tf 50 685 Td (========================================================================) Tj ET\n";

  let y = 665;
  for (const line of lines) {
    // Escape parentheses
    const safeLine = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    contentStream += `BT /F1 10 Tf 50 ${y} Td (${safeLine}) Tj ET\n`;
    y -= 16;
  }

  const objects = [];
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  objects.push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n"
  );
  objects.push(
    `4 0 obj\n<< /Length ${Buffer.byteLength(contentStream)} >>\nstream\n${contentStream}endstream\nendobj\n`
  );
  objects.push("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");

  let body = "%PDF-1.4\n";
  const xref = ["0000000000 65535 f \n"];

  for (const obj of objects) {
    const offset = Buffer.byteLength(body);
    xref.push(String(offset).padStart(10, "0") + " 00000 n \n");
    body += obj;
  }

  const startxref = Buffer.byteLength(body);
  let trailer = `xref\n0 ${objects.length + 1}\n`;
  for (const x of xref) {
    trailer += x;
  }
  trailer += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return Buffer.from(body + trailer, "utf8");
}

// ── Minimal Valid PNG Generator (100x100 medical cross placeholder) ──────────
function createPng() {
  const width = 120;
  const height = 120;

  // CRC32 table
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c;
  }

  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR: 120x120, 8-bit RGB
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = chunk("IHDR", ihdrData);

  // Raw image scanlines (each row: 1 filter byte (0) + width * 3 RGB bytes)
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const idx = 1 + x * 3;
      // Draw dark background with green medical cross
      const inCross = (x >= 50 && x <= 70 && y >= 30 && y <= 90) || (x >= 30 && x <= 90 && y >= 50 && y <= 70);
      if (inCross) {
        row[idx] = 16; // R
        row[idx + 1] = 185; // G (Emerald)
        row[idx + 2] = 129; // B
      } else {
        row[idx] = 15; // Dark slate
        row[idx + 1] = 23;
        row[idx + 2] = 42;
      }
    }
    rawRows.push(row);
  }

  const uncompressedData = Buffer.concat(rawRows);
  const compressedData = zlib.deflateSync(uncompressedData);
  const idat = chunk("IDAT", compressedData);
  const iend = chunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

// ── 1. Blood Test Report (Normal) ───────────────────────────────────────────
const bloodReport = createPdf("METRO CLINICAL LABORATORIES - BLOOD PANEL", [
  "PATIENT: Alice Walker (DEMO SYNTHETIC PATIENT)",
  "RECORD CATEGORY: Pathology (Blood Chemistry Panel)",
  "FACILITY: City Memorial Hospital (Demo Provider)",
  "DATE: 2026-10-14 09:30 UTC",
  "",
  "TEST NAME                 RESULT         REFERENCE RANGE      STATUS",
  "----------------------------------------------------------------------",
  "Complete Blood Count (CBC)",
  "  Hemoglobin              14.2 g/dL      12.0 - 15.5 g/dL     NORMAL",
  "  Hematocrit              41.5 %         37.0 - 48.0 %        NORMAL",
  "  WBC (White Blood Cells) 6.4 x10^3/uL   4.5 - 11.0 x10^3/uL  NORMAL",
  "  Platelets               245 x10^3/uL   150 - 450 x10^3/uL   NORMAL",
  "",
  "Metabolic Panel",
  "  Fasting Blood Glucose   92 mg/dL       70 - 99 mg/dL        NORMAL",
  "  Serum Sodium            140 mEq/L      136 - 145 mEq/L      NORMAL",
  "  Serum Potassium         4.2 mEq/L      3.5 - 5.0 mEq/L      NORMAL",
  "  Serum Creatinine        0.8 mg/dL      0.6 - 1.2 mg/dL      NORMAL",
  "  eGFR                    >90 mL/min     >60 mL/min           NORMAL",
  "",
  "Lipid Panel",
  "  Total Cholesterol       175 mg/dL      <200 mg/dL           OPTIMAL",
  "  HDL (Good)              58 mg/dL       >50 mg/dL            OPTIMAL",
  "  LDL (Calculated)        98 mg/dL       <100 mg/dL           OPTIMAL",
  "  Triglycerides           95 mg/dL       <150 mg/dL           NORMAL",
  "",
  "CONCLUSION: All laboratory indices are within established reference ranges.",
  "PHYSICIAN SIGNATURE: Dr. R. Adams, MD (License #DEMO-99214)",
]);

fs.writeFileSync(path.join(OUTPUT_DIR, "blood_test_report.pdf"), bloodReport);

// ── 2. Blood Test Report (Tampered for Tamper Demo) ──────────────────────────
const bloodReportTampered = createPdf("METRO CLINICAL LABORATORIES - BLOOD PANEL [ALTERED]", [
  "PATIENT: Alice Walker (DEMO SYNTHETIC PATIENT)",
  "RECORD CATEGORY: Pathology (Blood Chemistry Panel)",
  "FACILITY: City Memorial Hospital (Demo Provider)",
  "DATE: 2026-10-14 09:30 UTC",
  "",
  "TEST NAME                 RESULT         REFERENCE RANGE      STATUS",
  "----------------------------------------------------------------------",
  "Complete Blood Count (CBC)",
  "  Hemoglobin              14.2 g/dL      12.0 - 15.5 g/dL     NORMAL",
  "  Hematocrit              41.5 %         37.0 - 48.0 %        NORMAL",
  "  WBC (White Blood Cells) 6.4 x10^3/uL   4.5 - 11.0 x10^3/uL  NORMAL",
  "  Platelets               245 x10^3/uL   150 - 450 x10^3/uL   NORMAL",
  "",
  "Metabolic Panel",
  "  Fasting Blood Glucose   385 mg/dL      70 - 99 mg/dL        CRITICAL HIGH *** [TAMPERED VALUE]",
  "  Serum Sodium            140 mEq/L      136 - 145 mEq/L      NORMAL",
  "  Serum Potassium         4.2 mEq/L      3.5 - 5.0 mEq/L      NORMAL",
  "  Serum Creatinine        0.8 mg/dL      0.6 - 1.2 mg/dL      NORMAL",
  "  eGFR                    >90 mL/min     >60 mL/min           NORMAL",
  "",
  "Lipid Panel",
  "  Total Cholesterol       175 mg/dL      <200 mg/dL           OPTIMAL",
  "  HDL (Good)              58 mg/dL       >50 mg/dL            OPTIMAL",
  "  LDL (Calculated)        98 mg/dL       <100 mg/dL           OPTIMAL",
  "  Triglycerides           95 mg/dL       <150 mg/dL           NORMAL",
  "",
  "CONCLUSION: Severe hyperglycemia detected. Immediate clinical intervention required.",
  "PHYSICIAN SIGNATURE: Dr. R. Adams, MD (License #DEMO-99214)",
]);

fs.writeFileSync(path.join(TAMPER_DIR, "blood_test_report_modified.pdf"), bloodReportTampered);

// ── 3. Prescription PDF ─────────────────────────────────────────────────────
const prescription = createPdf("OUTPATIENT PRESCRIPTION ORDER", [
  "PATIENT: Alice Walker (DEMO SYNTHETIC PATIENT)",
  "RECORD CATEGORY: General Medicine",
  "FACILITY: City Memorial Hospital (Demo Provider)",
  "DATE: 2026-10-14 10:15 UTC",
  "",
  "Rx Orders:",
  "----------------------------------------------------------------------",
  "1. Amoxicillin / Clavulanate (Augmentin)",
  "   Dosage: 875 mg / 125 mg oral tablet",
  "   Sig: Take 1 tablet by mouth twice daily with meals for 10 days.",
  "   Quantity: 20 tablets | Refills: 0",
  "",
  "2. Fluticasone Propionate Nasal Spray",
  "   Dosage: 50 mcg/actuation",
  "   Sig: 1 spray per nostril once daily as needed for seasonal rhinitis.",
  "   Quantity: 1 bottle (16 g) | Refills: 2",
  "",
  "INSTRUCTIONS: Drink plenty of water. Complete full antibiotic course.",
  "PHYSICIAN: Dr. Emily Chen, MD (DEA #DEMO-771829)",
]);

fs.writeFileSync(path.join(OUTPUT_DIR, "prescription.pdf"), prescription);

// ── 4. Chest X-Ray PNG Placeholder ──────────────────────────────────────────
const xrayPng = createPng();
fs.writeFileSync(path.join(OUTPUT_DIR, "chest_xray.png"), xrayPng);

// ── 5. Discharge Summary TXT ────────────────────────────────────────────────
const dischargeSummary = `================================================================================
PATIENT DISCHARGE SUMMARY - NOT REAL MEDICAL DATA - SYNTHETIC DEMO ONLY
================================================================================
PATIENT NAME:         Alice Walker
RECORD ID (INTERNAL): MED-2026-9812
FACILITY:             City Memorial Hospital
DEPARTMENT:           Internal Medicine
ADMISSION DATE:       2026-10-10 14:00 UTC
DISCHARGE DATE:       2026-10-12 11:30 UTC
ATTENDING PHYSICIAN:  Dr. R. Adams, MD

PRIMARY DIAGNOSIS:
  Mild Community-Acquired Bronchitis (Resolved)

HOSPITAL COURSE:
  Patient presented with mild productive cough, low-grade pyrexia (37.9 C),
  and fatigue. Chest radiography performed on 2026-10-10 demonstrated clear
  bilateral lung fields without consolidation, pleural effusion, or pneumothorax.
  Laboratory blood indices were unremarkable. Patient was observed for 48 hours,
  treated with supportive hydration and oral antibiotics, and showed complete
  resolution of symptoms.

DISCHARGE MEDICATIONS:
  - Amoxicillin/Clavulanate 875/125mg PO BID x 10 days
  - Paracetamol 500mg PO PRN for discomfort

ACTIVITY & DIET:
  - Normal diet as tolerated
  - Resume light exercise as comfort permits

FOLLOW-UP PLAN:
  - Routine clinic review in 2 weeks with primary care physician.

CONFIDENTIALITY NOTICE:
  This document is synthetic demo data created for the MediConsent Hackathon.
  No real patient information is contained in this document.
================================================================================
`;

fs.writeFileSync(path.join(OUTPUT_DIR, "discharge_summary.txt"), dischargeSummary, "utf8");

// ── 6. Cardiology Report PDF (Category 1: Cardiology) ───────────────────────
const cardiologyReport = createPdf("CARDIAC DIAGNOSTIC CENTER - ECHOCARDIOGRAM REPORT", [
  "PATIENT: Alice Walker (DEMO SYNTHETIC PATIENT)",
  "RECORD CATEGORY: Cardiology (Transthoracic Echocardiogram)",
  "FACILITY: City Memorial Hospital - Heart Institute",
  "DATE: 2026-10-13 14:00 UTC",
  "",
  "ECHOCARDIOGRAPHIC FINDINGS:",
  "----------------------------------------------------------------------",
  "1. Left Ventricle (LV):",
  "   - Normal cavity dimensions. LVEDD: 4.8 cm, LVESD: 3.1 cm.",
  "   - Normal wall thickness. Interventricular septum: 0.9 cm.",
  "   - Preserved left ventricular systolic function.",
  "   - Estimated Left Ventricular Ejection Fraction (LVEF): 62% (Normal).",
  "",
  "2. Valvular Structure & Hemodynamics:",
  "   - Mitral Valve: Structurally normal leaflets. Trivial regurgitation.",
  "   - Aortic Valve: Trileaflet, opens well without stenosis. Peak velocity 1.2 m/s.",
  "   - Tricuspid Valve: Normal structure, physiological regurgitation. PASP: 22 mmHg.",
  "",
  "3. Pericardium & Great Vessels:",
  "   - No pericardial effusion identified.",
  "   - Ascending aorta normal caliber (3.0 cm). Inferior vena cava collapsibility >50%.",
  "",
  "IMPRESSION:",
  "  1. Normal biventricular size and systolic performance (LVEF 62%).",
  "  2. No significant valvular pathology. No evidence of pulmonary hypertension.",
  "",
  "ATTENDING CARDIOLOGIST: Dr. Marcus Vance, MD, FACC (License #CARD-88312)",
]);

fs.writeFileSync(path.join(OUTPUT_DIR, "cardiology_report.pdf"), cardiologyReport);

console.log("Synthetic sample data successfully generated in docs/sample-data/:");
console.log("  - blood_test_report.pdf (" + (bloodReport.length / 1024).toFixed(1) + " KB)");
console.log("  - prescription.pdf (" + (prescription.length / 1024).toFixed(1) + " KB)");
console.log("  - chest_xray.png (" + (xrayPng.length / 1024).toFixed(1) + " KB)");
console.log("  - discharge_summary.txt (" + (Buffer.byteLength(dischargeSummary) / 1024).toFixed(1) + " KB)");
console.log("  - cardiology_report.pdf (" + (cardiologyReport.length / 1024).toFixed(1) + " KB)");
console.log("  - tamper_test/blood_test_report_modified.pdf (" + (bloodReportTampered.length / 1024).toFixed(1) + " KB)");
