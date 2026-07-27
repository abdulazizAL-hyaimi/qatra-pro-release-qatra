#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
docs_path = ROOT / 'app/src/main/assets/qatra/assets/erp_water_documents.js'
reports_path = ROOT / 'app/src/main/assets/qatra/assets/erp_water_reports.js'

docs = docs_path.read_text(encoding='utf-8')
docs = docs.replace(
    '.report-paper{min-height:auto}.report-paper .paper-table{font-size:7.5pt}',
    '.report-paper{min-height:auto}.report-paper .paper-table{font-size:7.5pt}.report-paper .water-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:2mm;margin:2mm 0}.report-paper .water-kpis article{border:1px solid #c7d9e4;border-radius:1.5mm;padding:2mm;text-align:center}.report-paper .water-kpis article b{display:block;font-size:12pt}.report-paper .water-kpis article span{display:block;font-size:7pt;color:#607d8b;margin-top:.5mm}'
)
docs = docs.replace(
    "const ids=(record.paymentIds||[]).join('، ');",
    "const paymentIds=record.paymentIds||[],visibleIds=paymentIds.slice(0,12),ids=visibleIds.join('، ')+(paymentIds.length>visibleIds.length?` — و${paymentIds.length-visibleIds.length} سند إضافي`:'');"
)
docs_path.write_text(docs, encoding='utf-8')

reports = reports_path.read_text(encoding='utf-8')
reports = reports.replace('<table class="erp-table performance-table">',
                          '<table class="paper-table erp-table performance-table">')
reports_path.write_text(reports, encoding='utf-8')
print('Qatra A5 settlement and printed report templates hardened.')
