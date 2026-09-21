import PDFDocument from 'pdfkit';

export type PageFormat = 'A4' | 'A4_LANDSCAPE' | 'A3' | 'LETTER';

export interface PdfReportOptions {
  pageSize?: PageFormat;
  aiAnalysisText?: string | null;
  aiProviderLabel?: string | null;
  withAi?: boolean;
  logoBuffer?: Buffer | null;
}

function formatEuro(amount: number | null | undefined): string {
  const val = Number(amount) || 0;
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
    .format(val)
    .replace(/\u202F|\u00A0/g, ' ')
    .replace(/\s*€/, ' €');
}

function formatDateFr(isoDate?: string | null): string {
  if (!isoDate) return '-';
  const firstPart = isoDate.split('T')[0] ?? '';
  const parts = firstPart.split('-');
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return isoDate;
}

export async function generatePdfReport(
  data: any,
  options: PdfReportOptions = {}
): Promise<Buffer> {
  const format = options.pageSize || 'A4';
  const isLandscape = format === 'A4_LANDSCAPE';
  const pdfSize = format === 'A4_LANDSCAPE' ? 'A4' : format;

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: pdfSize as any,
        layout: isLandscape ? 'landscape' : 'portrait',
        margins: { top: 36, bottom: 40, left: 36, right: 36 },
        bufferPages: true,
        info: {
          Title: `Rapport Financier - ${data.association?.name || 'Association'}`,
          Author: data.association?.name || 'Association',
          Subject: 'Dossier Financier & Bilan de Trésorerie',
          Creator: 'TrésoGem'
        }
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const contentWidth = pageWidth - 72; // 36 left + 36 right margins

      const colors = {
        primary: '#173F34',
        accent: '#2A9D8F',
        green: '#16A34A',
        coral: '#E76F51',
        red: '#DC2626',
        dark: '#111827',
        text: '#374151',
        muted: '#6B7280',
        line: '#E5E7EB',
        lightBg: '#F9FAFB',
        calloutBg: '#F0FDF4',
        calloutBorder: '#86EFAC'
      };

      // Helper to check page break space
      function ensureSpace(neededHeight: number) {
        if (doc.y <= 45) return;
        if (doc.y + neededHeight > pageHeight - 45) {
          doc.addPage();
          doc.y = 36;
        }
      }

      // 1. TOP HEADER BANNER
      const startY = doc.y;
      const asso = data.association || {};
      const period = data.period || {};

      // Draw Logo or Association Badge
      if (options.logoBuffer && options.logoBuffer.length > 0) {
        try {
          doc.image(options.logoBuffer, 36, startY, { fit: [55, 55] });
        } catch {
          // Fallback monogram
          doc.rect(36, startY, 50, 50).fillAndStroke(colors.primary, colors.primary);
          doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold')
             .text((asso.name || 'A').slice(0, 1).toUpperCase(), 36, startY + 14, { width: 50, align: 'center' });
        }
      } else {
        doc.rect(36, startY, 50, 50).fillAndStroke(colors.primary, colors.primary);
        doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold')
           .text((asso.name || 'A').slice(0, 1).toUpperCase(), 36, startY + 14, { width: 50, align: 'center' });
      }

      // Association information
      const textStartX = 98;
      doc.font('Helvetica-Bold').fontSize(15).fillColor(colors.primary)
         .text(asso.name || 'ASSOCIATION', textStartX, startY + 2);
      
      doc.font('Helvetica').fontSize(8.5).fillColor(colors.muted);
      const legalBits = [];
      if (asso.address) legalBits.push(asso.address);
      if (asso.postalCode || asso.city) legalBits.push(`${asso.postalCode || ''} ${asso.city || ''}`.trim());
      if (asso.siret) legalBits.push(`SIRET : ${asso.siret}`);
      if (asso.rna) legalBits.push(`RNA : ${asso.rna}`);
      if (asso.email) legalBits.push(asso.email);
      doc.text(legalBits.join(' · ') || 'Trésorerie Associative', textStartX, startY + 22, { width: contentWidth - 260 });

      // Document Title Box (Right Aligned)
      const badgeWidth = 240;
      const badgeX = pageWidth - 36 - badgeWidth;
      doc.rect(badgeX, startY, badgeWidth, 50).fillAndStroke('#F3F4F6', colors.line);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(colors.primary)
         .text('DOSSIER FINANCIER & BILAN', badgeX, startY + 8, { width: badgeWidth, align: 'center' });
      doc.font('Helvetica').fontSize(8).fillColor(colors.dark)
         .text(`Période : ${formatDateFr(period.from)} au ${formatDateFr(period.to)}`, badgeX, startY + 24, { width: badgeWidth, align: 'center' });
      doc.font('Helvetica').fontSize(7.5).fillColor(colors.muted)
         .text(`Édité le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`, badgeX, startY + 36, { width: badgeWidth, align: 'center' });

      doc.y = startY + 62;
      doc.strokeColor(colors.primary).lineWidth(1.5).moveTo(36, doc.y).lineTo(pageWidth - 36, doc.y).stroke();
      doc.y += 10;

      // 2. EXECUTIVE KPI CARDS
      const totals = data.totals || {};
      const rec = data.reconciliation || {};
      const kpiCardWidth = (contentWidth - 30) / 4;
      const kpiY = doc.y;

      const kpis = [
        { label: 'TOTAL RECETTES', value: formatEuro(totals.income), sub: `${totals.countIncome || 0} écritures`, color: colors.green },
        { label: 'TOTAL DÉPENSES', value: formatEuro(totals.expense), sub: `${totals.countExpense || 0} écritures`, color: colors.coral },
        { label: 'RÉSULTAT NET', value: formatEuro(totals.net), sub: totals.net >= 0 ? 'Excédentaire' : 'Déficitaire', color: totals.net >= 0 ? colors.green : colors.red },
        { label: 'RAPPROCHEMENT', value: `${(rec.rate || 0).toFixed(0)} %`, sub: `${rec.fullyReconciled || 0}/${rec.totalCount || 0} validées`, color: colors.accent }
      ];

      kpis.forEach((kpi, idx) => {
        const x = 36 + idx * (kpiCardWidth + 10);
        doc.rect(x, kpiY, kpiCardWidth, 48).fillAndStroke(colors.lightBg, colors.line);
        doc.rect(x, kpiY, 4, 48).fill(kpi.color);

        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(colors.muted)
           .text(kpi.label, x + 10, kpiY + 7);
        doc.font('Helvetica-Bold').fontSize(12).fillColor(kpi.color)
           .text(kpi.value, x + 10, kpiY + 18);
        doc.font('Helvetica').fontSize(7.5).fillColor(colors.muted)
           .text(kpi.sub, x + 10, kpiY + 34);
      });

      doc.y = kpiY + 58;

      // 3. AI ANALYSIS & DIAGNOSTIC REPORT (IF WITH AI)
      if (options.aiAnalysisText && options.aiAnalysisText.trim()) {
        ensureSpace(120);
        const aiBoxY = doc.y;
        
        doc.rect(36, aiBoxY, contentWidth, 24).fillAndStroke(colors.calloutBg, colors.calloutBorder);
        doc.rect(36, aiBoxY, 4, 24).fill(colors.accent);
        const aiLabel = options.aiProviderLabel ? ` (IA : ${options.aiProviderLabel.toUpperCase()})` : ' (INTELLIGENCE ARTIFICIELLE)';
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(colors.primary)
           .text(`AUDIT ET DIAGNOSTIC FINANCIER${aiLabel}`, 48, aiBoxY + 7);

        doc.y = aiBoxY + 30;
        doc.font('Helvetica').fontSize(8.8).fillColor(colors.dark);
        
        // Clean markdown headings if any and write formatted paragraphs
        const paragraphs = options.aiAnalysisText.split(/\n\n+/);
        for (const p of paragraphs) {
          const trimmed = p.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('#') || trimmed.match(/^[0-9]\.\s+/)) {
            ensureSpace(35);
            const headingText = trimmed.replace(/^#+\s*/, '');
            doc.font('Helvetica-Bold').fontSize(9.5).fillColor(colors.primary).text(headingText);
            doc.font('Helvetica').fontSize(8.8).fillColor(colors.dark);
          } else {
            doc.text(trimmed, { align: 'justify', lineGap: 2 });
          }
          doc.y += 4;
        }
        doc.y += 6;
      }

      // HELPER: DRAW MONTHLY EVOLUTION BAR & LINE CHART
      function drawEvolutionChart(evolution: any[]) {
        if (!evolution || evolution.length === 0) return;
        const chartHeight = 115;
        ensureSpace(chartHeight + 20);

        const chartY = doc.y;
        doc.rect(36, chartY, contentWidth, chartHeight).fillAndStroke('#FAFCFB', colors.line);

        // Header and Legend in chart card
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(colors.primary)
           .text('Graphique de tendance mensuelle des flux', 46, chartY + 8);

        const legRight = pageWidth - 46;
        doc.font('Helvetica').fontSize(7.5);

        // Net line legend
        doc.strokeColor(colors.accent).lineWidth(1.5).moveTo(legRight - 55, chartY + 12).lineTo(legRight - 42, chartY + 12).stroke();
        doc.circle(legRight - 48, chartY + 12, 2).fill(colors.accent);
        doc.fillColor(colors.dark).text('Solde net', legRight - 38, chartY + 8);

        // Expense legend
        doc.rect(legRight - 115, chartY + 8, 8, 8).fill(colors.coral);
        doc.fillColor(colors.dark).text('Dépenses', legRight - 103, chartY + 8);

        // Income legend
        doc.rect(legRight - 175, chartY + 8, 8, 8).fill(colors.green);
        doc.fillColor(colors.dark).text('Recettes', legRight - 163, chartY + 8);

        // Chart plot coordinates
        const plotX = 85;
        const plotY = chartY + 24;
        const plotW = contentWidth - 60;
        const plotH = chartHeight - 44;
        const baselineY = plotY + plotH;

        const maxVal = Math.max(10, ...evolution.map((e: any) => Math.max(Number(e.income) || 0, Number(e.expense) || 0, Math.abs(Number(e.net) || 0))));

        // Horizontal grid lines: 100%, 50%, 0%
        doc.strokeColor('#E5E7EB').lineWidth(0.5);
        [0, 0.5, 1].forEach((fraction) => {
          const gy = baselineY - fraction * plotH;
          doc.moveTo(plotX, gy).lineTo(plotX + plotW, gy).stroke();
          const valLabel = formatEuro(fraction * maxVal);
          doc.font('Helvetica').fontSize(6.5).fillColor(colors.muted)
             .text(valLabel, 38, gy - 3, { width: 44, align: 'right' });
        });

        // Bars & Net line points
        const numItems = evolution.length;
        const slotW = plotW / numItems;
        const barW = Math.min(18, Math.max(6, (slotW - 10) / 2));
        const netPoints: Array<{ x: number; y: number }> = [];

        evolution.forEach((item: any, idx: number) => {
          const cx = plotX + idx * slotW + slotW / 2;
          const inc = Math.max(0, Number(item.income) || 0);
          const exp = Math.max(0, Number(item.expense) || 0);
          const net = Number(item.net) || 0;

          const incH = Math.max(1, (inc / maxVal) * plotH);
          const expH = Math.max(1, (exp / maxVal) * plotH);

          // Income bar (green)
          doc.rect(cx - barW - 1, baselineY - incH, barW, incH).fill(colors.green);
          // Expense bar (coral)
          doc.rect(cx + 1, baselineY - expH, barW, expH).fill(colors.coral);

          // Month label below axis
          doc.font('Helvetica').fontSize(7).fillColor(colors.dark)
             .text(item.period_month || '-', cx - slotW / 2, baselineY + 4, { width: slotW, align: 'center' });

          // Calculate point for Net line
          const netY = Math.max(plotY, Math.min(baselineY, baselineY - (net / maxVal) * plotH));
          netPoints.push({ x: cx, y: netY });
        });

        // Draw Net line across points
        if (netPoints.length > 1) {
          doc.strokeColor(colors.accent).lineWidth(1.5);
          doc.moveTo(netPoints[0]!.x, netPoints[0]!.y);
          for (let i = 1; i < netPoints.length; i++) {
            doc.lineTo(netPoints[i]!.x, netPoints[i]!.y);
          }
          doc.stroke();
        }
        // Draw Net circles
        netPoints.forEach((pt) => {
          doc.circle(pt.x, pt.y, 2.5).fillAndStroke('#FFFFFF', colors.accent);
        });

        doc.y = chartY + chartHeight + 10;
      }

      // HELPER: DRAW CATEGORY HORIZONTAL BAR CHART
      function drawCategoryBarChart(categories: any[]) {
        if (!categories || categories.length === 0) return;
        const expCategories = categories
          .filter((c: any) => (Number(c.expense) || 0) > 0)
          .sort((a: any, b: any) => (Number(b.expense) || 0) - (Number(a.expense) || 0))
          .slice(0, 5);

        if (expCategories.length === 0) return;
        const totalExp = expCategories.reduce((acc: number, c: any) => acc + (Number(c.expense) || 0), 0);
        const barCardH = 26 + expCategories.length * 20;
        ensureSpace(barCardH + 16);

        const cardY = doc.y;
        doc.rect(36, cardY, contentWidth, barCardH).fillAndStroke('#FAFCFB', colors.line);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(colors.primary)
           .text('Graphique de répartition des principales dépenses par catégorie', 46, cardY + 8);

        const trackX = 180;
        const trackW = contentWidth - 275;

        expCategories.forEach((cat: any, idx: number) => {
          const rowY = cardY + 24 + idx * 20;
          const exp = Number(cat.expense) || 0;
          const share = totalExp > 0 ? (exp / totalExp) : 0;
          const fillW = Math.max(3, share * trackW);

          const catColor = cat.color || colors.coral;
          doc.circle(48, rowY + 5, 3.5).fill(catColor);
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(colors.dark)
             .text(cat.name || 'Catégorie', 56, rowY + 1, { width: 115, ellipsis: true });

          // Background track & Fill bar
          doc.rect(trackX, rowY + 2, trackW, 8).fill('#E5E7EB');
          doc.rect(trackX, rowY + 2, fillW, 8).fill(catColor);

          // Amount and percentage
          doc.font('Helvetica').fontSize(7.5).fillColor(colors.dark)
             .text(`${formatEuro(exp)} (${(share * 100).toFixed(0)}%)`, trackX + trackW + 8, rowY + 1, { width: 80, align: 'right' });
        });

        doc.y = cardY + barCardH + 10;
      }

      // HELPER: DRAW PROJECT BUDGET PROGRESS GAUGE CHART
      function drawProjectBudgetChart(projects: any[]) {
        if (!projects || projects.length === 0) return;
        const activeProjects = projects.slice(0, 4);
        const cardH = 26 + activeProjects.length * 22;
        ensureSpace(cardH + 16);

        const cardY = doc.y;
        doc.rect(36, cardY, contentWidth, cardH).fillAndStroke('#FAFCFB', colors.line);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(colors.primary)
           .text('Graphique de consommation budgétaire par projet', 46, cardY + 8);

        const trackX = 180;
        const trackW = contentWidth - 250;

        activeProjects.forEach((prj: any, idx: number) => {
          const rowY = cardY + 24 + idx * 22;
          const budget = Number(prj.budget) || 0;
          const exp = Number(prj.expense) || 0;
          const ratio = budget > 0 ? Math.min(1.5, exp / budget) : 0;
          const fillW = Math.max(2, Math.min(1, ratio) * trackW);
          const barColor = ratio > 1 ? colors.red : (ratio > 0.85 ? '#F59E0B' : colors.green);

          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(colors.dark)
             .text(prj.name || 'Projet', 46, rowY, { width: 125, ellipsis: true });
          doc.font('Helvetica').fontSize(6.5).fillColor(colors.muted)
             .text(prj.status || 'EN_COURS', 46, rowY + 9);

          // Track & Fill bar
          doc.rect(trackX, rowY + 3, trackW, 8).fill('#E5E7EB');
          doc.rect(trackX, rowY + 3, fillW, 8).fill(barColor);

          // % label
          const pctLabel = budget > 0 ? `${(ratio * 100).toFixed(0)}% consommé` : 'Sans budget';
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(barColor)
             .text(pctLabel, trackX + trackW + 8, rowY + 2, { width: 55, align: 'right' });
        });

        doc.y = cardY + cardH + 10;
      }

      // HELPER: DRAW RECONCILIATION GAUGE
      function drawReconciliationGauge(rec: any) {
        const total = Number(rec.totalCount) || 0;
        const fully = Number(rec.fullyReconciled) || 0;
        const part = Number(rec.partiallyReconciled) || 0;
        const unrec = Number(rec.unreconciled) || 0;
        const rate = Number(rec.rate) || 0;

        const cardH = 58;
        ensureSpace(cardH + 16);

        const cardY = doc.y;
        doc.rect(36, cardY, contentWidth, cardH).fillAndStroke('#FAFCFB', colors.line);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(colors.primary)
           .text('Jauge de conformité des justificatifs et rapprochement bancaire', 46, cardY + 8);

        // Segmented bar
        const barX = 46;
        const barW = contentWidth - 20;
        const barY = cardY + 23;
        const barH = 10;

        const fullyW = total > 0 ? (fully / total) * barW : (rate / 100) * barW;
        const partW = total > 0 ? (part / total) * barW : 0;
        const unrecW = Math.max(0, barW - fullyW - partW);

        doc.rect(barX, barY, barW, barH).fill('#E5E7EB');
        if (fullyW > 0) doc.rect(barX, barY, fullyW, barH).fill(colors.green);
        if (partW > 0) doc.rect(barX + fullyW, barY, partW, barH).fill(colors.accent);
        if (unrecW > 0) doc.rect(barX + fullyW + partW, barY, unrecW, barH).fill(colors.coral);

        // Legend below bar
        const legY = barY + 14;
        doc.rect(barX, legY, 7, 7).fill(colors.green);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(colors.dark)
           .text(`Justifiées à 100% : ${fully} (${rate.toFixed(0)}%)`, barX + 10, legY);

        doc.rect(barX + 170, legY, 7, 7).fill(colors.accent);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(colors.dark)
           .text(`Partiellement justifiées : ${part}`, barX + 180, legY);

        doc.rect(barX + 320, legY, 7, 7).fill(colors.coral);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(colors.dark)
           .text(`En attente de justificatif : ${unrec}`, barX + 330, legY);

        doc.y = cardY + cardH + 10;
      }

      // 4. SECTION: ÉVOLUTION MENSUELLE
      if (Array.isArray(data.evolution) && data.evolution.length > 0) {
        ensureSpace(70);
        doc.font('Helvetica-Bold').fontSize(11).fillColor(colors.primary).text('1. Évolution des flux de trésorerie par mois');
        doc.y += 6;

        // Vector graph of evolution
        drawEvolutionChart(data.evolution);

        // Numerical Table Header
        const colW = contentWidth / 5;
        const thY = doc.y;
        doc.rect(36, thY, contentWidth, 18).fillAndStroke(colors.primary, colors.primary);
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
        doc.text('Mois / Période', 42, thY + 5, { width: colW });
        doc.text('Recettes', 36 + colW, thY + 5, { width: colW - 10, align: 'right' });
        doc.text('Dépenses', 36 + colW * 2, thY + 5, { width: colW - 10, align: 'right' });
        doc.text('Solde du mois', 36 + colW * 3, thY + 5, { width: colW - 10, align: 'right' });
        doc.text('Nb opérations', 36 + colW * 4, thY + 5, { width: colW, align: 'center' });

        doc.y = thY + 18;
        data.evolution.forEach((item: any, i: number) => {
          ensureSpace(16);
          const rowY = doc.y;
          const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightBg;
          doc.rect(36, rowY, contentWidth, 16).fillAndStroke(bg, colors.line);
          doc.font('Helvetica').fontSize(8).fillColor(colors.dark);
          doc.text(item.period_month || '-', 42, rowY + 4, { width: colW });
          doc.font('Helvetica').fillColor(colors.green).text(formatEuro(item.income), 36 + colW, rowY + 4, { width: colW - 10, align: 'right' });
          doc.font('Helvetica').fillColor(colors.coral).text(formatEuro(item.expense), 36 + colW * 2, rowY + 4, { width: colW - 10, align: 'right' });
          doc.font('Helvetica-Bold').fillColor(item.net >= 0 ? colors.green : colors.red)
             .text((item.net > 0 ? '+' : '') + formatEuro(item.net), 36 + colW * 3, rowY + 4, { width: colW - 10, align: 'right' });
          doc.font('Helvetica').fillColor(colors.dark).text(String(item.count || 0), 36 + colW * 4, rowY + 4, { width: colW, align: 'center' });
          doc.y = rowY + 16;
        });
        doc.y += 10;
      }

      // 5. SECTION: VENTILATION PAR CATÉGORIE
      if (Array.isArray(data.byCategory) && data.byCategory.length > 0) {
        ensureSpace(70);
        doc.font('Helvetica-Bold').fontSize(11).fillColor(colors.primary).text('2. Répartition analytique par catégorie');
        doc.y += 6;

        // Vector graph of category breakdown
        drawCategoryBarChart(data.byCategory);

        const catW0 = contentWidth * 0.35;
        const catW1 = contentWidth * 0.15;
        const catW2 = contentWidth * 0.16;
        const catW3 = contentWidth * 0.16;
        const catW4 = contentWidth * 0.18;

        const thY = doc.y;
        doc.rect(36, thY, contentWidth, 18).fillAndStroke(colors.primary, colors.primary);
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
        doc.text('Catégorie', 42, thY + 5, { width: catW0 });
        doc.text('Type', 36 + catW0, thY + 5, { width: catW1 });
        doc.text('Recettes', 36 + catW0 + catW1, thY + 5, { width: catW2 - 8, align: 'right' });
        doc.text('Dépenses', 36 + catW0 + catW1 + catW2, thY + 5, { width: catW3 - 8, align: 'right' });
        doc.text('Solde Net', 36 + catW0 + catW1 + catW2 + catW3, thY + 5, { width: catW4 - 8, align: 'right' });

        doc.y = thY + 18;
        data.byCategory.forEach((cat: any, i: number) => {
          ensureSpace(16);
          const rowY = doc.y;
          const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightBg;
          doc.rect(36, rowY, contentWidth, 16).fillAndStroke(bg, colors.line);
          doc.font('Helvetica-Bold').fontSize(8).fillColor(colors.dark)
             .text(cat.name || 'Sans catégorie', 42, rowY + 4, { width: catW0 });
          doc.font('Helvetica').fontSize(7.5).fillColor(colors.muted)
             .text(cat.kind || 'DEPENSE', 36 + catW0, rowY + 4, { width: catW1 });
          doc.font('Helvetica').fontSize(8).fillColor(colors.green)
             .text(cat.income > 0 ? formatEuro(cat.income) : '-', 36 + catW0 + catW1, rowY + 4, { width: catW2 - 8, align: 'right' });
          doc.font('Helvetica').fontSize(8).fillColor(colors.coral)
             .text(cat.expense > 0 ? formatEuro(cat.expense) : '-', 36 + catW0 + catW1 + catW2, rowY + 4, { width: catW3 - 8, align: 'right' });
          doc.font('Helvetica-Bold').fontSize(8).fillColor(cat.net >= 0 ? colors.green : colors.red)
             .text((cat.net > 0 ? '+' : '') + formatEuro(cat.net), 36 + catW0 + catW1 + catW2 + catW3, rowY + 4, { width: catW4 - 8, align: 'right' });
          doc.y = rowY + 16;
        });
        doc.y += 10;
      }

      // 6. SECTION: SUIVI DES PROJETS
      if (Array.isArray(data.byProject) && data.byProject.length > 0) {
        ensureSpace(70);
        doc.font('Helvetica-Bold').fontSize(11).fillColor(colors.primary).text('3. Suivi des projets & consommations budgétaires');
        doc.y += 6;

        // Vector graph of project budgets
        drawProjectBudgetChart(data.byProject);

        const prjW0 = contentWidth * 0.32;
        const prjW1 = contentWidth * 0.16;
        const prjW2 = contentWidth * 0.16;
        const prjW3 = contentWidth * 0.18;
        const prjW4 = contentWidth * 0.18;

        const thY = doc.y;
        doc.rect(36, thY, contentWidth, 18).fillAndStroke(colors.primary, colors.primary);
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
        doc.text('Projet', 42, thY + 5, { width: prjW0 });
        doc.text('Statut', 36 + prjW0, thY + 5, { width: prjW1 });
        doc.text('Budget Voté', 36 + prjW0 + prjW1, thY + 5, { width: prjW2 - 8, align: 'right' });
        doc.text('Dépenses', 36 + prjW0 + prjW1 + prjW2, thY + 5, { width: prjW3 - 8, align: 'right' });
        doc.text('Solde Disponible', 36 + prjW0 + prjW1 + prjW2 + prjW3, thY + 5, { width: prjW4 - 8, align: 'right' });

        doc.y = thY + 18;
        data.byProject.forEach((prj: any, i: number) => {
          ensureSpace(16);
          const rowY = doc.y;
          const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightBg;
          const budget = Number(prj.budget) || 0;
          const remaining = budget - (Number(prj.expense) || 0);

          doc.rect(36, rowY, contentWidth, 16).fillAndStroke(bg, colors.line);
          doc.font('Helvetica-Bold').fontSize(8).fillColor(colors.dark)
             .text(prj.name || 'Projet', 42, rowY + 4, { width: prjW0 });
          doc.font('Helvetica').fontSize(7.5).fillColor(colors.muted)
             .text(prj.status || 'EN_COURS', 36 + prjW0, rowY + 4, { width: prjW1 });
          doc.font('Helvetica').fontSize(8).fillColor(colors.dark)
             .text(budget > 0 ? formatEuro(budget) : '-', 36 + prjW0 + prjW1, rowY + 4, { width: prjW2 - 8, align: 'right' });
          doc.font('Helvetica').fontSize(8).fillColor(colors.coral)
             .text(formatEuro(prj.expense), 36 + prjW0 + prjW1 + prjW2, rowY + 4, { width: prjW3 - 8, align: 'right' });
          doc.font('Helvetica-Bold').fontSize(8).fillColor(remaining >= 0 ? colors.green : colors.red)
             .text(budget > 0 ? formatEuro(remaining) : '-', 36 + prjW0 + prjW1 + prjW2 + prjW3, rowY + 4, { width: prjW4 - 8, align: 'right' });
          doc.y = rowY + 16;
        });
        doc.y += 10;
      }

      // 7. SECTION: RAPPROCHEMENT & CONTRÔLE INTERNE
      ensureSpace(60);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(colors.primary).text('4. Rapprochement bancaire & contrôle interne');
      doc.y += 6;

      // Vector gauge of reconciliation
      drawReconciliationGauge(rec);

      const recY = doc.y;
      const recBoxW = (contentWidth - 20) / 3;

      doc.rect(36, recY, recBoxW, 36).fillAndStroke(colors.lightBg, colors.line);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(colors.green).text('JUSTIFIÉES À 100%', 44, recY + 6);
      doc.font('Helvetica-Bold').fontSize(12).fillColor(colors.dark).text(String(rec.fullyReconciled || 0), 44, recY + 18);

      doc.rect(36 + recBoxW + 10, recY, recBoxW, 36).fillAndStroke(colors.lightBg, colors.line);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(colors.coral).text('EN ATTENTE DE PIÈCE', 44 + recBoxW + 10, recY + 6);
      doc.font('Helvetica-Bold').fontSize(12).fillColor(colors.dark).text(String(rec.unreconciled || 0), 44 + recBoxW + 10, recY + 18);

      doc.rect(36 + (recBoxW + 10) * 2, recY, recBoxW, 36).fillAndStroke(colors.lightBg, colors.line);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(colors.accent).text('TAUX DE JUSTIFICATION', 44 + (recBoxW + 10) * 2, recY + 6);
      doc.font('Helvetica-Bold').fontSize(12).fillColor(colors.dark).text(`${(rec.rate || 0).toFixed(1)} %`, 44 + (recBoxW + 10) * 2, recY + 18);

      doc.y = recY + 46;

      // 8. FOOTERS ON ALL BUFFERED PAGES
      const totalPages = doc.bufferedPageRange().count;
      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(i);
        const oldBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        const footerY = pageHeight - 24;
        doc.strokeColor(colors.line).lineWidth(0.8).moveTo(36, footerY).lineTo(pageWidth - 36, footerY).stroke();
        doc.font('Helvetica').fontSize(7.5).fillColor(colors.muted);
        doc.text(`${asso.name || 'Association'} · Dossier de Trésorerie Officiel`, 36, footerY + 5, { lineBreak: false });
        doc.text(`Page ${i + 1} sur ${totalPages}`, pageWidth - 36 - 120, footerY + 5, { width: 120, align: 'right', lineBreak: false });
        doc.page.margins.bottom = oldBottom;
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
