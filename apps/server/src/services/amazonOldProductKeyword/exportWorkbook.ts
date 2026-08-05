/**
 * Excel export via @office-kit/xlsx — formulas, freeze, autofilter, charts.
 * Plain text is formula-injection safe; only whitelist system formulas become formulas.
 */
import {
  buildExportFileName,
  type KeywordDecision,
  type MaterializedViews,
  VIEW_SHEET_NAMES,
  type ViewId,
} from '@lobechat/utils';
import { setFormula } from '@office-kit/xlsx/cell';
import { makeBarSeries, makeChartSpace, makeLineChart } from '@office-kit/xlsx/chart';
import { addChartAt } from '@office-kit/xlsx/drawing';
import { workbookToBytes } from '@office-kit/xlsx/io';
import {
  setBold,
  setCellAsCurrency,
  setCellBackgroundColor,
  setCellNumberFormat,
} from '@office-kit/xlsx/styles';
import { addWorksheet, createWorkbook } from '@office-kit/xlsx/workbook';
import {
  addExcelTable,
  makeAutoFilter,
  setAutoFilter,
  setCell,
  setFreezePanes,
} from '@office-kit/xlsx/worksheet';

type Wb = ReturnType<typeof createWorkbook>;
type Ws = ReturnType<typeof addWorksheet>;

const HEADER_BG = 'FF1F2937';

/** Prefix dangerous leading chars so Excel never treats user text as formula. */
const safeText = (v: unknown): string => {
  if (v == null) return '';
  const s = String(v);
  if (/^[=+\-@]/.test(s)) return `'${s}`;
  return s;
};

const writeHeader = (wb: Wb, ws: Ws, row: number, headers: string[]) => {
  headers.forEach((h, i) => {
    const cell = setCell(ws, row, i + 1, h);
    setBold(wb, cell);
    setCellBackgroundColor(wb, cell, HEADER_BG);
    // force light text via font color on style if available — bold is enough for table header
  });
};

const writeKwSheet = (
  wb: Wb,
  name: string,
  list: KeywordDecision[],
  opts?: { problemMode?: boolean },
) => {
  const ws = addWorksheet(wb, name.slice(0, 31));
  // A..Y = 25 cols. CVR = 订单/点击 (P/Q), ACoS = 花费/销售额 (R/S)
  const headers = [
    '关键词',
    '关键词分类',
    '相关性',
    '语义分',
    '综合分',
    '运营标签',
    '主要来源渠道',
    '主要广告活动',
    '主要广告组',
    '主要匹配/投放',
    '主要来源订单',
    '主要来源花费($)',
    '来源活动数',
    '来源组合数',
    '建议执行层级',
    '当前订单',
    '当前点击',
    '当前花费($)',
    '当前销售额($)',
    '当前CVR',
    '当前ACoS',
    '历史订单',
    '全部来源组合',
    '语义依据',
    '差距标签',
  ];
  writeHeader(wb, ws, 1, headers);
  list.forEach((d, idx) => {
    const r = idx + 2;
    const vals: unknown[] = [
      safeText(d.keyword),
      safeText(d.category),
      safeText(d.relevanceLabel),
      d.relevanceScore,
      d.compositeScore,
      safeText(d.opsLabel),
      safeText(d.primarySource?.channel),
      safeText(d.primarySource?.campaign ?? '当前未投放/未检出'),
      safeText(d.primarySource?.adGroup ?? ''),
      safeText(d.primarySource?.matchOrTarget),
      d.primarySource?.orders ?? 0,
      d.primarySource?.spend ?? 0,
      d.sourceCampaignCount ?? 0,
      d.sourceComboCount ?? 0,
      safeText(d.executionLevel),
      d.current?.orders ?? 0,
      d.current?.clicks ?? 0,
      d.current?.spend ?? 0,
      d.current?.sales ?? 0,
      null, // CVR formula col T
      null, // ACoS formula col U
      d.history?.orders ?? 0,
      safeText(d.allSourceCombos),
      safeText(d.rationale),
      safeText(d.gapLabel),
    ];
    vals.forEach((v, i) => {
      const col = i + 1;
      if (i === 19 || i === 20) return; // formulas
      const cell = setCell(ws, r, col, v as any);
      if (i === 11 || i === 17 || i === 18) setCellAsCurrency(wb, cell, { symbol: '$' });
      if (i === 3 || i === 4) setCellNumberFormat(wb, cell, '0.0');
    });
    // CVR = 当前订单/当前点击 ; ACoS = 当前花费/当前销售额
    setFormula(setCell(ws, r, 20, null), `IFERROR(P${r}/Q${r},0)`, {
      cachedValue: d.current?.cvr ?? 0,
    });
    setFormula(setCell(ws, r, 21, null), `IFERROR(R${r}/S${r},0)`, {
      cachedValue: d.current?.acos ?? 0,
    });
  });
  const last = Math.max(list.length + 1, 2);
  const range = `A1:Y${last}`;
  setFreezePanes(ws, 'B2');
  setAutoFilter(ws, makeAutoFilter({ ref: range }));
  if (list.length > 0) {
    try {
      addExcelTable(wb, ws, {
        name: `T_${name.replaceAll(/\W/g, '').slice(0, 20) || 'kw'}`,
        ref: range,
        columns: headers,
        style: 'TableStyleMedium2',
      });
    } catch {
      // table name collision — autofilter already set
    }
  }
  void opts;
  return ws;
};

export const buildWorkbookBuffer = async (
  views: MaterializedViews,
  categoryName: string,
): Promise<{ buffer: Buffer; fileName: string }> => {
  const wb = createWorkbook();
  const fileName = buildExportFileName(categoryName);
  const s = (views.overview.summary ?? {}) as Record<string, unknown>;

  // 1 总览
  {
    const ws = addWorksheet(wb, VIEW_SHEET_NAMES.overview);
    setBold(wb, setCell(ws, 1, 1, safeText(views.overview.title)));
    setCell(ws, 2, 1, '主ASIN');
    setCell(ws, 2, 2, safeText(views.overview.mainAsin));
    const kpis: [string, unknown][] = [
      ['全量自然关键词', s.naturalKeywordCount ?? 0],
      ['语义高相关词', s.highRelevanceCount ?? 0],
      ['高胜率词', s.highWinCount ?? 0],
      ['新机会词', s.newOpportunityCount ?? 0],
      ['低效+否词候选', s.lowEfficiencyAndNegativeCount ?? 0],
      ['SP自然关键词订单', s.spNaturalOrders ?? 0],
      ['SP ACoS', s.spAcos ?? null],
      ['SB点击归因订单', s.sbClickOrders ?? 0],
      ['SB ACoS', s.sbAcos ?? null],
      ['ASIN商品否定候选', s.asinNegativeCandidateCount ?? 0],
      ['受限模式', s.limitedMode ? '是' : '否'],
    ];
    kpis.forEach(([label, val], i) => {
      setCell(ws, 4 + i, 1, label);
      setCell(ws, 4 + i, 2, val as any);
    });
    // formula counts against full lexicon when available
    const lexName = VIEW_SHEET_NAMES.full_lexicon;
    setCell(ws, 16, 1, '全量词库行数(公式)');
    setFormula(setCell(ws, 16, 2, null), `COUNTA('${lexName}'!A3:A100000)`, {
      cachedValue: views.full_lexicon.length,
    });
    setCell(ws, 17, 1, '高胜率词数(公式)');
    setFormula(setCell(ws, 17, 2, null), `COUNTIF('${lexName}'!E3:E100000,"高胜率词")`, {
      cachedValue: views.high_win.length,
    });
  }

  writeKwSheet(wb, VIEW_SHEET_NAMES.high_win, views.high_win);
  writeKwSheet(wb, VIEW_SHEET_NAMES.new_opportunity, views.new_opportunity);
  writeKwSheet(wb, VIEW_SHEET_NAMES.low_efficiency, views.low_efficiency, { problemMode: true });
  writeKwSheet(wb, VIEW_SHEET_NAMES.history_sleep, views.history_sleep);
  writeKwSheet(wb, VIEW_SHEET_NAMES.competitor_gap, views.competitor_gap);

  // ASIN
  {
    const ws = addWorksheet(wb, VIEW_SHEET_NAMES.asin_negative);
    const headers = [
      'ASIN',
      '建议',
      '判断依据',
      '当前总花费($)',
      '当前总销售额($)',
      '当前总订单',
      '当前ACoS',
      '投放展示量',
      '投放点击',
      '投放花费($)',
      '投放订单',
      'SP搜索词展示',
      'SP搜索词点击',
      'SP搜索词花费($)',
      'SP搜索词订单',
      'SB搜索词点击',
      'SB搜索词花费($)',
      'SB点击订单',
      '历史点击',
      '历史花费($)',
    ];
    writeHeader(wb, ws, 1, headers);
    views.asin_negative.forEach((a, idx) => {
      const r = idx + 2;
      const row = [
        safeText(a.asin),
        safeText(a.suggestion),
        safeText(a.rationale),
        a.currentSpend ?? 0,
        a.currentSales ?? 0,
        a.currentOrders ?? 0,
        a.currentAcos ?? null,
        a.targetingImpressions ?? 0,
        a.targetingClicks ?? 0,
        a.targetingSpend ?? 0,
        a.targetingOrders ?? 0,
        a.spSearchImpressions ?? 0,
        a.spSearchClicks ?? 0,
        a.spSearchSpend ?? 0,
        a.spSearchOrders ?? 0,
        a.sbSearchClicks ?? 0,
        a.sbSearchSpend ?? 0,
        a.sbClickOrders ?? 0,
        a.historyClicks ?? 0,
        a.historySpend ?? 0,
      ];
      row.forEach((v, i) => setCell(ws, r, i + 1, v as any));
      setFormula(setCell(ws, r, 7, null), `IFERROR(D${r}/E${r},0)`, {
        cachedValue: a.currentAcos ?? 0,
      });
    });
    const last = Math.max(views.asin_negative.length + 1, 2);
    setFreezePanes(ws, 'B2');
    setAutoFilter(ws, makeAutoFilter({ ref: `A1:T${last}` }));
  }

  writeKwSheet(wb, VIEW_SHEET_NAMES.full_lexicon, views.full_lexicon);
  writeKwSheet(wb, VIEW_SHEET_NAMES.brand_ads, views.brand_ads);

  // SP投放
  {
    const ws = addWorksheet(wb, VIEW_SHEET_NAMES.sp_targeting);
    const headers = [
      '投放类型',
      '投放对象',
      '匹配类型',
      'ASIN',
      '展示量',
      '点击',
      '花费($)',
      '销售额($)',
      '订单',
      'CVR',
      'ACoS',
      '建议',
      '判断依据',
    ];
    writeHeader(wb, ws, 1, headers);
    views.sp_targeting.forEach((t, idx) => {
      const r = idx + 2;
      [
        safeText(t.targetType),
        safeText(t.target),
        safeText(t.matchType),
        safeText(t.asin),
        t.impressions ?? 0,
        t.clicks ?? 0,
        t.spend ?? 0,
        t.sales ?? 0,
        t.orders ?? 0,
        t.cvr ?? null,
        t.acos ?? null,
        safeText(t.suggestion),
        safeText(t.rationale),
      ].forEach((v, i) => setCell(ws, r, i + 1, v as any));
      setFormula(setCell(ws, r, 10, null), `IFERROR(I${r}/F${r},0)`, {
        cachedValue: t.cvr ?? 0,
      });
      setFormula(setCell(ws, r, 11, null), `IFERROR(G${r}/H${r},0)`, {
        cachedValue: t.acos ?? 0,
      });
    });
    const last = Math.max(views.sp_targeting.length + 1, 2);
    setFreezePanes(ws, 'A2');
    setAutoFilter(ws, makeAutoFilter({ ref: `A1:M${last}` }));
  }

  // 每日趋势 + charts
  {
    const sheetName = VIEW_SHEET_NAMES.daily_trend;
    const ws = addWorksheet(wb, sheetName);
    const headers = [
      '日期',
      'SP展示量',
      'SP点击',
      'SP花费($)',
      'SP销售额($)',
      'SP订单',
      'SB展示量',
      'SB点击',
      'SB花费($)',
      'SB点击销售额($)',
      'SB点击订单',
      'SB总订单',
      '合计花费($)',
      '合计点击订单',
    ];
    writeHeader(wb, ws, 1, headers);
    views.daily_trend.forEach((d, idx) => {
      const r = idx + 2;
      const spend = (d.spSpend ?? 0) + (d.sbSpend ?? 0);
      const orders = (d.spOrders ?? 0) + (d.sbClickOrders ?? 0);
      [
        d.date,
        d.spImpressions ?? 0,
        d.spClicks ?? 0,
        d.spSpend ?? 0,
        d.spSales ?? 0,
        d.spOrders ?? 0,
        d.sbImpressions ?? 0,
        d.sbClicks ?? 0,
        d.sbSpend ?? 0,
        d.sbClickSales ?? 0,
        d.sbClickOrders ?? 0,
        d.sbTotalOrders ?? 0,
        spend,
        orders,
      ].forEach((v, i) => setCell(ws, r, i + 1, v as any));
      setFormula(setCell(ws, r, 13, null), `D${r}+I${r}`, { cachedValue: spend });
      setFormula(setCell(ws, r, 14, null), `F${r}+K${r}`, { cachedValue: orders });
    });
    const n = views.daily_trend.length;
    const last = Math.max(n + 1, 2);
    setFreezePanes(ws, 'A2');
    setAutoFilter(ws, makeAutoFilter({ ref: `A1:N${last}` }));
    if (n >= 2) {
      const end = n + 1;
      try {
        const orderChart = makeLineChart({
          series: [
            makeBarSeries({
              idx: 0,
              tx: { kind: 'literal', value: 'SP订单' },
              cat: { ref: `'${sheetName}'!$A$2:$A$${end}` },
              val: { ref: `'${sheetName}'!$F$2:$F$${end}` },
            }),
            makeBarSeries({
              idx: 1,
              tx: { kind: 'literal', value: 'SB点击订单' },
              cat: { ref: `'${sheetName}'!$A$2:$A$${end}` },
              val: { ref: `'${sheetName}'!$K$2:$K$${end}` },
            }),
          ],
        });
        addChartAt(
          ws,
          'P2',
          {
            space: makeChartSpace({
              plotArea: { chart: orderChart },
              title: 'SP vs SB 订单',
              legend: { position: 'r' },
            }),
          },
          { widthPx: 520, heightPx: 280 },
        );
        const spendChart = makeLineChart({
          series: [
            makeBarSeries({
              idx: 0,
              tx: { kind: 'literal', value: 'SP花费' },
              cat: { ref: `'${sheetName}'!$A$2:$A$${end}` },
              val: { ref: `'${sheetName}'!$D$2:$D$${end}` },
            }),
            makeBarSeries({
              idx: 1,
              tx: { kind: 'literal', value: 'SB花费' },
              cat: { ref: `'${sheetName}'!$A$2:$A$${end}` },
              val: { ref: `'${sheetName}'!$I$2:$I$${end}` },
            }),
          ],
        });
        addChartAt(
          ws,
          'P18',
          {
            space: makeChartSpace({
              plotArea: { chart: spendChart },
              title: 'SP vs SB 花费',
              legend: { position: 'r' },
            }),
          },
          { widthPx: 520, heightPx: 280 },
        );
      } catch {
        // chart optional if series shape fails
      }
    }
  }

  // 评分规则
  {
    const ws = addWorksheet(wb, VIEW_SHEET_NAMES.scoring_rules);
    writeHeader(wb, ws, 1, ['参数', '当前值', '用途']);
    views.scoring_rules.forEach((r, idx) => {
      setCell(ws, idx + 2, 1, safeText((r as any).参数));
      setCell(ws, idx + 2, 2, (r as any).当前值 as any);
      setCell(ws, idx + 2, 3, safeText((r as any).用途));
    });
    setFreezePanes(ws, 'A2');
  }

  // 数据源
  {
    const ws = addWorksheet(wb, VIEW_SHEET_NAMES.data_sources);
    writeHeader(wb, ws, 1, [
      '文件',
      '角色',
      '实际范围/粒度',
      '用途',
      '排除',
      '质量处理',
      '备注',
      '缺失',
    ]);
    views.data_sources.forEach((r, idx) => {
      [
        safeText(r.file),
        safeText(r.role),
        safeText(r.rangeOrGranularity),
        safeText(r.usage),
        safeText(r.excluded),
        safeText(r.quality),
        safeText(r.notes),
        r.missing ? '是' : '否',
      ].forEach((v, i) => setCell(ws, idx + 2, i + 1, v));
    });
    setFreezePanes(ws, 'A2');
  }

  const bytes = await workbookToBytes(wb);
  return { buffer: Buffer.from(bytes), fileName };
};

export type { ViewId };
