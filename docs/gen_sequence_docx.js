const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  VerticalAlign, Header, Footer, PageNumber, TableOfContents,
  LevelFormat, ExternalHyperlink, PageBreak
} = require('docx');
const fs = require('fs');

// ── Colour palette ───────────────────────────────────────────────────────────
const C = {
  darkBlue:   '1F3864',
  midBlue:    '2E5FA3',
  lightBlue:  'D9E8F5',
  phase1:     'E6F5FF',
  phase2:     'FFF5E6',
  phase3:     'EFFFEF',
  phase4:     'FFFACC',
  phase5:     'F0F0FF',
  phase6:     'FFF0F0',
  phase7:     'F0FFF8',
  rollback:   'FFE6E6',
  actorBg:    '1F3864',
  msgBg:      'FAFAFA',
  arrowFwd:   '1F7A1F',
  arrowBack:  'C0392B',
  white:      'FFFFFF',
  border:     'ADB9CA',
  noteGrey:   'F2F2F2',
  stepNum:    '2E5FA3',
  headerBg:   '1F3864',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: C.border };
const thickBorder = { style: BorderStyle.SINGLE, size: 4, color: C.midBlue };
const cellBorders = (t=thinBorder,b=thinBorder,l=thinBorder,r=thinBorder) =>
  ({ top: t, bottom: b, left: l, right: r });
const allThin = cellBorders();
const allNone = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

function spacer(pts=80) {
  return new Paragraph({ spacing: { before: pts, after: pts }, children: [] });
}

function heading(text, level=HeadingLevel.HEADING_1) {
  return new Paragraph({ heading: level, children: [new TextRun(text)] });
}

function body(text, opts={}) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    children: [new TextRun({ text, size: 20, font: 'Arial', ...opts })]
  });
}

function cell(children, bg, width, opts={}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { fill: bg, type: ShadingType.CLEAR },
    borders: opts.borders || allThin,
    margins: { top: opts.mt||80, bottom: opts.mb||80, left: opts.ml||120, right: opts.mr||120 },
    verticalAlign: opts.va || VerticalAlign.CENTER,
    children: Array.isArray(children) ? children : [children],
  });
}

// ── Actor header row ─────────────────────────────────────────────────────────
// Actors + widths (total = 12240 - 1440*2 = 9360 DXA for landscape 11x8.5)
// Landscape content width: 15840 - 2*1080 = 13680
const ACTORS = [
  { label: '👤 User /\nRequester',          width: 1700 },
  { label: '🎫 ServiceNow\nITSM',           width: 1800 },
  { label: '⚙️ AAP Job\nTemplate\n(Dispatcher)', width: 1900 },
  { label: '📖 Account →\nWorkflow\nDictionary', width: 1900 },
  { label: '🔄 AAP\nWorkflow\n(Acct-Specific)', width: 1900 },
  { label: '🖥️ AWS EC2\nInstances',         width: 1780 },
  { label: '📦 S3 / SIEM\n(Audit)',         width: 1700 },
];
const TOTAL_W = ACTORS.reduce((s,a)=>s+a.width, 0); // 12680

function actorHeaderRow() {
  return new TableRow({
    tableHeader: true,
    children: ACTORS.map(a =>
      new TableCell({
        width: { size: a.width, type: WidthType.DXA },
        shading: { fill: C.actorBg, type: ShadingType.CLEAR },
        borders: { top: thickBorder, bottom: thickBorder, left: thinBorder, right: thinBorder },
        margins: { top: 120, bottom: 120, left: 100, right: 100 },
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: a.label.split('\n').flatMap((line, i) => [
              ...(i>0 ? [new TextRun({ break: 1 })] : []),
              new TextRun({ text: line, bold: true, color: C.white, size: 16, font: 'Arial' })
            ])
          })
        ]
      })
    )
  });
}

// ── Step row builder ─────────────────────────────────────────────────────────
// fromIdx / toIdx: 0-based column index
// direction: 'fwd' | 'back' | 'self'
function stepRow(stepNum, fromIdx, toIdx, label, bgColor, opts={}) {
  const direction = fromIdx < toIdx ? 'fwd' : fromIdx > toIdx ? 'back' : 'self';
  const arrowColor = direction === 'fwd' ? C.arrowFwd : direction === 'back' ? C.arrowBack : C.midBlue;
  const arrowChar  = direction === 'fwd' ? '→' : direction === 'back' ? '←' : '↺';

  const cells = ACTORS.map((a, i) => {
    const isFrom   = i === fromIdx;
    const isTo     = i === toIdx;
    const isBridge = i > Math.min(fromIdx,toIdx) && i < Math.max(fromIdx,toIdx);
    const isActive = isFrom || isTo || isBridge;

    let cellBg = isActive ? (bgColor+'33') : C.msgBg;
    let content;

    if (isFrom && isTo) {
      // self-call
      content = new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 40 },
        children: [
          new TextRun({ text: `${stepNum}`, bold: true, color: C.stepNum, size: 16, font: 'Arial' }),
          new TextRun({ text: `  ↺  `, color: arrowColor, size: 16, font: 'Arial' }),
          ...label.split('\n').flatMap((l,idx) => [
            ...(idx>0 ? [new TextRun({ break: 1 })] : []),
            new TextRun({ text: l, size: 16, font: 'Arial', color: '333333' })
          ])
        ]
      });
      cellBg = bgColor+'44';
    } else if (isFrom) {
      content = new Paragraph({
        alignment: direction === 'fwd' ? AlignmentType.RIGHT : AlignmentType.LEFT,
        spacing: { before: 40, after: 40 },
        children: [
          new TextRun({ text: `${stepNum}  `, bold: true, color: C.stepNum, size: 16, font: 'Arial' }),
          new TextRun({ text: direction === 'fwd' ? '────' : '────', color: arrowColor, size: 16, font: 'Arial' })
        ]
      });
    } else if (isTo) {
      content = new Paragraph({
        alignment: direction === 'fwd' ? AlignmentType.LEFT : AlignmentType.RIGHT,
        spacing: { before: 40, after: 40 },
        children: [
          new TextRun({ text: `${arrowChar} `, bold: true, color: arrowColor, size: 18, font: 'Arial' }),
          ...label.split('\n').flatMap((l,idx) => [
            ...(idx>0 ? [new TextRun({ break: 1 })] : []),
            new TextRun({ text: l, size: 15, font: 'Arial', color: '222222', ...(opts.bold?{bold:true}:{}) })
          ])
        ]
      });
    } else if (isBridge) {
      content = new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 40 },
        children: [new TextRun({ text: '──────', color: arrowColor, size: 16, font: 'Arial' })]
      });
    } else {
      content = new Paragraph({
        spacing: { before: 40, after: 40 },
        children: [new TextRun({ text: '', size: 16 })]
      });
      cellBg = C.white;
    }

    return new TableCell({
      width: { size: a.width, type: WidthType.DXA },
      shading: { fill: cellBg.replace('#',''), type: ShadingType.CLEAR },
      borders: { top: thinBorder, bottom: thinBorder, left: noBorder, right: noBorder },
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      verticalAlign: VerticalAlign.CENTER,
      children: [content]
    });
  });

  return new TableRow({ children: cells });
}

// ── Phase label row ──────────────────────────────────────────────────────────
function phaseRow(label, bg) {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: ACTORS.length,
        width: { size: TOTAL_W, type: WidthType.DXA },
        shading: { fill: bg, type: ShadingType.CLEAR },
        borders: {
          top:    { style: BorderStyle.SINGLE, size: 3, color: C.midBlue },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: C.border },
          left:   { style: BorderStyle.SINGLE, size: 3, color: C.midBlue },
          right:  { style: BorderStyle.SINGLE, size: 3, color: C.midBlue },
        },
        margins: { top: 80, bottom: 60, left: 200, right: 120 },
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: '▶  ' + label, bold: true, size: 18, color: C.darkBlue, font: 'Arial' })
            ]
          })
        ]
      })
    ]
  });
}

// ── Note row ─────────────────────────────────────────────────────────────────
function noteRow(text) {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: ACTORS.length,
        width: { size: TOTAL_W, type: WidthType.DXA },
        shading: { fill: C.noteGrey, type: ShadingType.CLEAR },
        borders: allNone,
        margins: { top: 40, bottom: 40, left: 200, right: 120 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: '  ℹ  ' + text, italics: true, size: 16, color: '555555', font: 'Arial' })]
          })
        ]
      })
    ]
  });
}

// ── Lifeline spacer row ───────────────────────────────────────────────────────
function lifelineRow(height=200) {
  return new TableRow({
    height: { value: height, rule: 'atLeast' },
    children: ACTORS.map(a =>
      new TableCell({
        width: { size: a.width, type: WidthType.DXA },
        shading: { fill: C.white, type: ShadingType.CLEAR },
        borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        children: [new Paragraph({ children: [] })]
      })
    )
  });
}

// ── Build main diagram table ─────────────────────────────────────────────────
function buildDiagramTable() {
  const rows = [
    actorHeaderRow(),

    // Phase 1
    phaseRow('Phase 1 — RFC Creation & Approval', C.phase1),
    stepRow(1, 0, 1,  'Create RFC Ticket\n(AWS Account ID: 123456789012,\nPatch Group, Maint. Window)', C.phase1),
    stepRow(2, 1, 1,  'Validate RFC Fields &\nRoute for Approval\n(State → Pending)', C.phase1),
    stepRow(3, 1, 0,  'RFC CHG0012345 Created\nStatus: Pending Approval', C.phase1),
    stepRow(4, 0, 1,  'Approve RFC', C.phase1),
    stepRow(5, 1, 1,  'RFC State → "Approved"\nMaintenance Window Locked', C.phase1),

    // Phase 2
    phaseRow('Phase 2 — AAP Dispatcher Trigger', C.phase2),
    stepRow(6, 1, 2,  'Webhook POST\n{ account_id: "123456789012",\nrfc_number: "CHG0012345",\npatch_group: "rhel8-prod" }', C.phase2),
    stepRow(7, 2, 2,  'Validate Payload &\nVerify RFC = Approved', C.phase2),
    stepRow(8, 2, 3,  'Lookup account_id\n"123456789012"', C.phase2),
    stepRow(9, 3, 2,  'Return workflow_id\n"WF-042" (prod-us-east-1)', C.phase2),
    stepRow(10, 2, 2, 'Resolve Workflow Template\nWF-042 in AAP Controller', C.phase2),

    // Phase 3
    phaseRow('Phase 3 — Workflow Launch', C.phase3),
    stepRow(11, 2, 4, 'Launch Workflow WF-042\n{ account_id, rfc_number,\npatch_group, maint_window }', C.phase3),
    stepRow(12, 4, 1, 'Update RFC → "Implement"', C.phase3),
    stepRow(13, 4, 4, 'Sync Dynamic Inventory\n(amazon.aws.aws_ec2 plugin,\nfilter: tag:RFC=CHG0012345)', C.phase3),

    // Phase 4
    phaseRow('Phase 4 — Pre-Patch Checks & EBS Snapshot', C.phase4),
    stepRow(14, 4, 5, 'Pre-Health Check\n(disk >20%, critical services up,\nbaseline kernel capture)', C.phase4),
    stepRow(15, 5, 4, '✅ Health OK\n(kernel=5.15.0, services up)', C.phase4),
    stepRow(16, 4, 5, 'Create EBS Snapshots\n(tag: RFC=CHG0012345,\nRetentionDays=30)', C.phase4),
    stepRow(17, 5, 4, 'Snapshot IDs\n["snap-0abc123", "snap-0def456"]', C.phase4),

    // Phase 5
    phaseRow('Phase 5 — Patch Execution (serial: 20%)', C.phase5),
    stepRow(18, 4, 5, 'Execute OS Patching\n(dnf/apt security-only,\n20% rolling serial)', C.phase5),
    stepRow(19, 5, 4, 'Patches Applied\nReboot Required: true', C.phase5),
    stepRow(20, 4, 5, 'Reboot Instances\n(timeout: 600s)', C.phase5),
    stepRow(21, 5, 4, '✅ Instance Online\n(kernel=5.15.1 updated)', C.phase5),

    // Phase 6
    phaseRow('Phase 6 — Post-Patch Validation', C.phase6),
    stepRow(22, 4, 5, 'Post-Health Check\n(services, kernel diff,\napp response)', C.phase6),
    stepRow(23, 5, 4, '✅ POST-HEALTH PASS\n(all services up, kernel upgraded)', C.phase6),

    // Phase 7
    phaseRow('Phase 7 — RFC Closure & Audit Logging', C.phase7),
    stepRow(24, 4, 1, 'Close RFC CHG0012345\nState → "Closed Complete"\nClose Notes: Patched successfully', C.phase7),
    stepRow(25, 1, 0, '✅ RFC Closed\nEmail Notification Sent', C.phase7),
    stepRow(26, 4, 6, 'Write Audit Log\ns3://company-aap-patch-logs/\nCHG0012345/2026-03-21.json', C.phase7),
    stepRow(27, 6, 4, 'Audit Log Stored ✅', C.phase7),
  ];

  return new Table({
    width: { size: TOTAL_W, type: WidthType.DXA },
    columnWidths: ACTORS.map(a => a.width),
    rows,
  });
}

// ── Build rollback table ──────────────────────────────────────────────────────
const RB_ACTORS = [
  { label: '🔄 AAP\nWorkflow', width: 2200 },
  { label: '🖥️ AWS EC2\nInstances', width: 2200 },
  { label: '🎫 ServiceNow\nITSM',   width: 2200 },
  { label: '📟 Ops Team\n(PagerDuty)', width: 2200 },
  { label: '📦 S3 / SIEM\n(Audit)',  width: 2200 },
];
const RB_TOTAL = RB_ACTORS.reduce((s,a)=>s+a.width,0); // 11000

function rbActorRow() {
  return new TableRow({
    tableHeader: true,
    children: RB_ACTORS.map(a =>
      new TableCell({
        width: { size: a.width, type: WidthType.DXA },
        shading: { fill: 'B71C1C', type: ShadingType.CLEAR },
        borders: { top: { style: BorderStyle.SINGLE, size: 4, color: 'B71C1C' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'B71C1C' }, left: thinBorder, right: thinBorder },
        margins: { top: 120, bottom: 120, left: 100, right: 100 },
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: a.label.split('\n').flatMap((line,i) => [
              ...(i>0 ? [new TextRun({ break: 1 })] : []),
              new TextRun({ text: line, bold: true, color: C.white, size: 18, font: 'Arial' })
            ])
          })
        ]
      })
    )
  });
}

function rbStepRow(num, from, to, label, direction='fwd') {
  const arrowColor = direction === 'back' ? C.arrowBack : direction === 'self' ? C.midBlue : C.arrowFwd;
  const arrowChar  = direction === 'back' ? '←' : direction === 'self' ? '↺' : '→';

  const cells = RB_ACTORS.map((a,i) => {
    const isFrom   = i === from;
    const isTo     = i === to;
    const isBridge = i > Math.min(from,to) && i < Math.max(from,to);

    let content;
    let cellBg = C.white;

    if (isFrom && isTo) {
      content = new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: `${num}  ↺  `, bold: true, color: arrowColor, size: 16, font: 'Arial' }),
          ...label.split('\n').flatMap((l,idx)=>[
            ...(idx>0?[new TextRun({break:1})]:[]),
            new TextRun({text:l,size:15,font:'Arial'})
          ])
        ]
      });
      cellBg = 'FFE6E6';
    } else if (isFrom) {
      content = new Paragraph({
        alignment: direction==='fwd' ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [
          new TextRun({ text: `${num}  ────`, bold: true, color: arrowColor, size: 16, font: 'Arial' })
        ]
      });
      cellBg = 'FFE6E6';
    } else if (isTo) {
      content = new Paragraph({
        alignment: direction==='fwd' ? AlignmentType.LEFT : AlignmentType.RIGHT,
        children: [
          new TextRun({ text: `${arrowChar}  `, bold: true, color: arrowColor, size: 18, font: 'Arial' }),
          ...label.split('\n').flatMap((l,idx)=>[
            ...(idx>0?[new TextRun({break:1})]:[]),
            new TextRun({text:l,size:15,font:'Arial'})
          ])
        ]
      });
      cellBg = 'FFE6E6';
    } else if (isBridge) {
      content = new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: '──────', color: arrowColor, size: 16, font: 'Arial' })]
      });
      cellBg = 'FFF0F0';
    } else {
      content = new Paragraph({ children: [new TextRun({ text: '', size: 16 })] });
      cellBg = C.white;
    }

    return new TableCell({
      width: { size: a.width, type: WidthType.DXA },
      shading: { fill: cellBg, type: ShadingType.CLEAR },
      borders: { top: thinBorder, bottom: thinBorder, left: noBorder, right: noBorder },
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      verticalAlign: VerticalAlign.CENTER,
      children: [content]
    });
  });
  return new TableRow({ children: cells });
}

function buildRollbackTable() {
  return new Table({
    width: { size: RB_TOTAL, type: WidthType.DXA },
    columnWidths: RB_ACTORS.map(a => a.width),
    rows: [
      rbActorRow(),
      new TableRow({
        children: [
          new TableCell({
            columnSpan: RB_ACTORS.length,
            width: { size: RB_TOTAL, type: WidthType.DXA },
            shading: { fill: 'B71C1C', type: ShadingType.CLEAR },
            borders: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder },
            margins: { top: 80, bottom: 60, left: 200, right: 120 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: '🔴  Failure Path — Automatic Rollback via EBS Snapshot Restore', bold: true, size: 18, color: C.white, font: 'Arial' })]
              })
            ]
          })
        ]
      }),
      rbStepRow(1,  0, 1, 'Patch Execution / Post-Health Check', 'fwd'),
      rbStepRow(2,  1, 0, '❌ FAILURE\n(service down / health check failed)', 'back'),
      rbStepRow(3,  0, 1, 'Stop Instance', 'fwd'),
      rbStepRow(4,  0, 1, 'Detach Failed Root Volume', 'fwd'),
      rbStepRow(5,  0, 1, 'Restore EBS Snapshot\n(snap-0abc123)', 'fwd'),
      rbStepRow(6,  0, 1, 'Re-attach Restored Volume &\nStart Instance', 'fwd'),
      rbStepRow(7,  1, 0, '✅ Instance Restored', 'back'),
      rbStepRow(8,  0, 2, 'Update RFC → "Closed Incomplete"\nReason: Auto-rollback triggered', 'fwd'),
      rbStepRow(9,  0, 3, 'PagerDuty Alert 🔔\nPatching failed — rollback complete', 'fwd'),
      rbStepRow(10, 0, 4, 'Write Failure Audit Log to S3', 'fwd'),
    ]
  });
}

// ── Actor reference table ────────────────────────────────────────────────────
function buildActorTable() {
  const data = [
    ['Actor',                           'Description',                                                                          'Technology'],
    ['👤 User / Requester',             'Engineer or team requesting AWS account patching through ITSM portal',                  'ServiceNow Self-Service'],
    ['🎫 ServiceNow ITSM',              'RFC lifecycle: creation, approval, state transitions, notifications',                   'ServiceNow + Webhook'],
    ['⚙️ AAP Job Template (Dispatcher)','Entry-point JT that validates RFC and resolves account → workflow mapping',             'AAP Controller 2.4+'],
    ['📖 Account → Workflow Dictionary','Map of AWS Account IDs to AAP Workflow IDs stored as extra vars or custom credential', 'AAP Extra Vars / Vault'],
    ['🔄 AAP Workflow (Account-Specific)','Per-account workflow running all patch stages with health gates and rollback logic', 'AAP Workflow Template'],
    ['🖥️ AWS EC2 Instances',            'Target patch hosts; filtered by tag:RFC via dynamic inventory',                        'amazon.aws.aws_ec2 plugin'],
    ['📦 S3 / SIEM (Audit)',            'Structured JSON audit logs per patching run; forwarded to SIEM for compliance',         'AWS S3 + CloudWatch'],
  ];

  const colWidths = [2200, 5500, 2200];

  return new Table({
    width: { size: 9900, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: data.map((row, ri) =>
      new TableRow({
        tableHeader: ri === 0,
        children: row.map((text, ci) =>
          new TableCell({
            width: { size: colWidths[ci], type: WidthType.DXA },
            shading: { fill: ri === 0 ? C.darkBlue : ri%2===0 ? 'F5F7FA' : C.white, type: ShadingType.CLEAR },
            borders: allThin,
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text,
                    bold: ri === 0,
                    color: ri === 0 ? C.white : '222222',
                    size: ri === 0 ? 17 : 16,
                    font: 'Arial'
                  })
                ]
              })
            ]
          })
        )
      })
    )
  });
}

// ── Dictionary / design decisions table ─────────────────────────────────────
function buildDecisionTable() {
  const data = [
    ['#', 'Decision',                                            'Rationale'],
    ['1', 'Single dispatcher JT routes to per-account workflows','Isolates blast radius; each account has tailored variables and regions'],
    ['2', 'Dictionary stored as AAP extra vars / credential',    'Avoids hardcoding; updatable without playbook changes or code deploys'],
    ['3', 'RFC approval checked before any AWS action',          'Enforces ITIL change control compliance; blocks unauthorised patching'],
    ['4', 'EBS snapshot taken before patching',                  'Enables sub-30-min point-in-time rollback without data loss'],
    ['5', 'Serial patching at 20%',                              'Prevents full fleet outage if a patch or reboot causes application failure'],
    ['6', 'Post-health check gates RFC closure',                 'RFC only auto-closes on verified success; failures auto-rollback and alert'],
  ];
  const colWidths = [400, 4000, 5500];

  return new Table({
    width: { size: 9900, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: data.map((row, ri) =>
      new TableRow({
        tableHeader: ri === 0,
        children: row.map((text, ci) =>
          new TableCell({
            width: { size: colWidths[ci], type: WidthType.DXA },
            shading: { fill: ri === 0 ? C.darkBlue : ri%2===0 ? 'F5F7FA' : C.white, type: ShadingType.CLEAR },
            borders: allThin,
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              new Paragraph({
                children: [new TextRun({ text, bold: ri===0, color: ri===0 ? C.white : '222222', size: ri===0?17:16, font: 'Arial' })]
              })
            ]
          })
        )
      })
    )
  });
}

// ── Dictionary YAML table ────────────────────────────────────────────────────
function buildDictTable() {
  const entries = [
    ['111111111111', 'WF-001', 'dev-account'],
    ['222222222222', 'WF-015', 'staging-us-east-1'],
    ['333333333333', 'WF-028', 'staging-us-west-2'],
    ['123456789012', 'WF-042', 'prod-us-east-1  ← example account'],
    ['987654321098', 'WF-055', 'prod-us-west-2'],
    ['555555555555', 'WF-071', 'prod-eu-west-1'],
  ];
  const colWidths = [2000, 1400, 4000];

  return new Table({
    width: { size: 7400, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: ['AWS Account ID', 'Workflow ID', 'Description / Environment'].map((h,ci) =>
          new TableCell({
            width: { size: colWidths[ci], type: WidthType.DXA },
            shading: { fill: C.darkBlue, type: ShadingType.CLEAR },
            borders: allThin,
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: C.white, size: 17, font: 'Arial' })] })]
          })
        )
      }),
      ...entries.map((row,ri) =>
        new TableRow({
          children: row.map((text,ci) =>
            new TableCell({
              width: { size: colWidths[ci], type: WidthType.DXA },
              shading: { fill: ri%2===0 ? 'F5F7FA' : C.white, type: ShadingType.CLEAR },
              borders: allThin,
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [new Paragraph({ children: [new TextRun({ text, size: 16, font: 'Courier New', color: '222222' })] })]
            })
          )
        })
      )
    ]
  });
}

// ── Document assembly ────────────────────────────────────────────────────────
const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Arial', size: 20 } }
    },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run:       { size: 36, bold: true, color: C.darkBlue, font: 'Arial' },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0,
                     border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.midBlue } } }
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run:       { size: 26, bold: true, color: C.midBlue, font: 'Arial' },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 }
      },
      {
        id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run:       { size: 22, bold: true, color: '444444', font: 'Arial' },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 }
      },
    ]
  },
  sections: [
    // ── Cover page ───────────────────────────────────────────────────────────
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      children: [
        spacer(1440),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 240 },
          children: [
            new TextRun({ text: 'Ansible Automation Platform', bold: true, size: 52, color: C.darkBlue, font: 'Arial' }),
            new TextRun({ break: 1 }),
            new TextRun({ text: 'AWS RFC Patching Workflow', bold: true, size: 52, color: C.midBlue, font: 'Arial' }),
          ]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 160, after: 160 },
          children: [new TextRun({ text: 'Sequence Diagram & Design Reference', size: 28, color: '555555', font: 'Arial', italics: true })]
        }),
        spacer(400),
        new Table({
          width: { size: 5040, type: WidthType.DXA },
          columnWidths: [2520, 2520],
          rows: [
            ['Version', '1.0'],
            ['Date', '2026-03-21'],
            ['Status', 'Draft'],
            ['Author', 'Platform Engineering'],
            ['Classification', 'Internal'],
          ].map(([k,v]) => new TableRow({
            children: [
              new TableCell({
                width: { size: 2520, type: WidthType.DXA },
                shading: { fill: C.darkBlue, type: ShadingType.CLEAR },
                borders: allThin,
                margins: { top: 80, bottom: 80, left: 200, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: k, bold: true, color: C.white, size: 18, font: 'Arial' })] })]
              }),
              new TableCell({
                width: { size: 2520, type: WidthType.DXA },
                shading: { fill: 'F5F7FA', type: ShadingType.CLEAR },
                borders: allThin,
                margins: { top: 80, bottom: 80, left: 200, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: v, size: 18, font: 'Arial', color: '222222' })] })]
              }),
            ]
          }))
        }),
        new Paragraph({ children: [new PageBreak()] })
      ]
    },

    // ── Main content (landscape for diagram) ─────────────────────────────────
    {
      properties: {
        page: {
          // Landscape: pass portrait dims, set LANDSCAPE
          size: { width: 12240, height: 15840, orientation: 'landscape' },
          margin: { top: 720, right: 720, bottom: 720, left: 720 }
        }
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.midBlue } },
            children: [
              new TextRun({ text: 'AAP AWS RFC Patching — Sequence Diagram', bold: true, size: 18, color: C.darkBlue, font: 'Arial' }),
              new TextRun({ text: '    |    Version 1.0    |    2026-03-21', size: 16, color: '777777', font: 'Arial' }),
            ]
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            border: { top: { style: BorderStyle.SINGLE, size: 2, color: C.border } },
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: 'Page ', size: 16, color: '777777', font: 'Arial' }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '777777', font: 'Arial' }),
              new TextRun({ text: ' of ', size: 16, color: '777777', font: 'Arial' }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '777777', font: 'Arial' }),
            ]
          })]
        })
      },
      children: [
        heading('1. Happy Path Sequence Diagram', HeadingLevel.HEADING_1),
        body('The diagram below shows the complete end-to-end flow from RFC ticket creation through ServiceNow to automated patching via AAP.'),
        spacer(80),
        buildDiagramTable(),
        spacer(160),

        new Paragraph({ children: [new PageBreak()] }),
        heading('2. Failure / Rollback Path', HeadingLevel.HEADING_1),
        body('When any patching or health-check step fails, the workflow automatically triggers EBS snapshot restore and notifies the on-call team.'),
        spacer(80),
        buildRollbackTable(),
      ]
    },

    // ── Reference section (portrait) ─────────────────────────────────────────
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
        }
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.midBlue } },
            children: [
              new TextRun({ text: 'AAP AWS RFC Patching — Reference', bold: true, size: 18, color: C.darkBlue, font: 'Arial' }),
              new TextRun({ text: '    |    Version 1.0    |    2026-03-21', size: 16, color: '777777', font: 'Arial' }),
            ]
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            border: { top: { style: BorderStyle.SINGLE, size: 2, color: C.border } },
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: 'Page ', size: 16, color: '777777', font: 'Arial' }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '777777', font: 'Arial' }),
              new TextRun({ text: ' of ', size: 16, color: '777777', font: 'Arial' }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '777777', font: 'Arial' }),
            ]
          })]
        })
      },
      children: [
        heading('3. Actor Reference', HeadingLevel.HEADING_1),
        spacer(80),
        buildActorTable(),
        spacer(240),

        heading('4. Account → Workflow Dictionary', HeadingLevel.HEADING_1),
        body('The dispatcher Job Template holds a dictionary mapping each AWS Account ID to its dedicated AAP Workflow ID. This is stored as AAP extra variables or a custom credential so it can be updated without modifying playbooks.'),
        spacer(80),
        buildDictTable(),
        spacer(240),

        heading('5. Key Design Decisions', HeadingLevel.HEADING_1),
        spacer(80),
        buildDecisionTable(),
        spacer(240),

        heading('6. Flow Summary', HeadingLevel.HEADING_1),
        new Paragraph({
          numbering: { reference: 'steps', level: 0 },
          children: [new TextRun({ text: 'User raises RFC ticket in ServiceNow with AWS Account ID and patch group.', size: 20, font: 'Arial' })]
        }),
        new Paragraph({
          numbering: { reference: 'steps', level: 0 },
          children: [new TextRun({ text: 'ServiceNow routes the RFC through the approval workflow; approver approves it.', size: 20, font: 'Arial' })]
        }),
        new Paragraph({
          numbering: { reference: 'steps', level: 0 },
          children: [new TextRun({ text: 'On approval, ServiceNow fires a webhook to the AAP Dispatcher Job Template with Account ID and RFC number.', size: 20, font: 'Arial' })]
        }),
        new Paragraph({
          numbering: { reference: 'steps', level: 0 },
          children: [new TextRun({ text: 'Dispatcher JT looks up the Account ID in the dictionary and resolves the correct Workflow ID.', size: 20, font: 'Arial' })]
        }),
        new Paragraph({
          numbering: { reference: 'steps', level: 0 },
          children: [new TextRun({ text: 'Dispatcher launches the account-specific AAP Workflow with all required parameters.', size: 20, font: 'Arial' })]
        }),
        new Paragraph({
          numbering: { reference: 'steps', level: 0 },
          children: [new TextRun({ text: 'Workflow syncs the dynamic inventory, filtering EC2 hosts by RFC tag.', size: 20, font: 'Arial' })]
        }),
        new Paragraph({
          numbering: { reference: 'steps', level: 0 },
          children: [new TextRun({ text: 'Pre-health checks and EBS snapshots are captured before any changes.', size: 20, font: 'Arial' })]
        }),
        new Paragraph({
          numbering: { reference: 'steps', level: 0 },
          children: [new TextRun({ text: 'Security-only patches are applied in 20% rolling serial batches.', size: 20, font: 'Arial' })]
        }),
        new Paragraph({
          numbering: { reference: 'steps', level: 0 },
          children: [new TextRun({ text: 'Instances are rebooted and post-health checks validate success.', size: 20, font: 'Arial' })]
        }),
        new Paragraph({
          numbering: { reference: 'steps', level: 0 },
          children: [new TextRun({ text: 'On success: RFC auto-closes and audit log is written to S3/SIEM.', size: 20, font: 'Arial' })]
        }),
        new Paragraph({
          numbering: { reference: 'steps', level: 0 },
          children: [new TextRun({ text: 'On failure: EBS snapshot restore runs automatically, RFC is closed incomplete, and PagerDuty fires.', size: 20, font: 'Arial' })]
        }),
      ]
    }
  ],
  numbering: {
    config: [
      {
        reference: 'steps',
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 }, spacing: { before: 80, after: 80 } } }
        }]
      }
    ]
  }
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('docs/aap-aws-rfc-patch-sequence.docx', buf);
  console.log('✅  Written: docs/aap-aws-rfc-patch-sequence.docx');
});
