// analyze() の結果を、Humanが読むMarkdownにする（Obsidianでそのまま読める表）。
const yen = (x) => (x == null || !Number.isFinite(x) ? '−' : `${Math.round(x).toLocaleString('en-US')}`);
const pct = (x) => (x == null || !Number.isFinite(x) ? '−' : `${(x * 100).toFixed(1)}%`);
const PLAN = { monthly: '月額', annual: '年額' };
const USAGE = { light: '少量', typical: '標準', cap: '上限' };
const SCHEME = { first_purchase: '初回のみ', first_year: '初年度のみ', recurring: '継続' };
const STATUS = { confirmed: '確認済み', measured: '実測', estimate: '推定', assumption: '仮定', unverified: '未確認' };

function table(head, rows) {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

export function toMarkdown(res, sc) {
  const s = res.selection;
  const fee = (k) => sc.params.storeFees[k]?.label ?? k;
  const vp = (k) => sc.params.voiceProviders[k]?.label ?? k;
  const L = [];
  L.push(`# ${res.app.name ?? res.app.id} 収益シミュレーション（${res.asOf ?? ''}）`, '');
  L.push('自動生成：`tools/revenue-sim`。**すべて仮定を含む試算で、実績・実請求ではない。** 値の確度は末尾の「前提と出所」を見る。', '');
  L.push(`- 基準：音声 ${vp(s.voiceProvider)}・テキスト ${sc.params.textModels[s.textModel]?.label ?? s.textModel}・為替 ¥${s.fx}/USD・税 ${sc.params.tax.mode}`);
  L.push(`- 注目の組み合わせ：月額 ${res.focus.pricePair[0]}円／年額 ${res.focus.pricePair[1]}円・音声 ${res.focus.voiceQuota}分・テキスト ${res.focus.textQuota}回`);
  L.push(`- 紹介報酬の既定：${pct(res.focusReferralRate)}・継続課金に対して（最も重い方式）。基準は2つを併記：**貢献基準**（実際の貢献利益）と**契約基準**（en-partner-hub で計算できる「推定手取り−固定控除 ${sc.params.referral.deductionPerCoveredMonth}円／月」）。1人あたりの表は「その利用者が紹介経由」の場合。目標の受取比：${pct(res.targetMargin)}`);
  const cr = sc.params.costReport ?? { basis: 'provider' };
  L.push(`- 中継の原価上限：$${sc.params.costCapUsdPerMonth ?? '−'}／月。報告の作り：${cr.basis === 'per_user_minute' ? `利用者1分あたり一律 $${cr.reportedUsdPerUserMinute}（今の実装）→ 事業者に関係なく ${(sc.params.costCapUsdPerMonth / cr.reportedUsdPerUserMinute).toFixed(1)}分で止まり、値上げ・無音の課金からは守らない` : '事業者の実原価（上限が実費の天井）'}`);
  if (res.overrides && Object.keys(res.overrides).length) L.push(`- **上書き（--set）**：${JSON.stringify(res.overrides)}（末尾の「前提と出所」は上書き前の値）`);
  L.push(`- 金額の単位：円（税込の売上を除き、税抜・手数料後の受取の基準）。「受取比」＝報酬控除後の貢献利益÷受取`, '');

  L.push('## 自動の注意（機械的に検出したもの）', '');
  if (!res.flags.length) L.push('- なし');
  for (const f of res.flags.slice(0, 40)) L.push(`- [${f.level}] ${f.text}`);
  if (res.flags.length > 40) L.push(`- ほか ${res.flags.length - 40}件（JSON を見る）`);
  L.push('');

  L.push('## 1. 単位原価', '', '### 音声（安全係数込み・利用者の枠1分あたり）', '', `円／分は原価上限を外した単価（注目の${res.focus.voiceQuota}分を使った時の接続の付加分を含む）。各分数の原価は上限込みの実費。`, '');
  L.push(table(['事業者', '為替', '円／分', ...res.voiceUnit[0].perQuota.map((q) => `${q.quota}分の原価`), '原価上限に当たる分'],
    res.voiceUnit.map((r) => [vp(r.provider), `¥${r.fx}`, r.yenPerMinute.toFixed(1), ...r.perQuota.map((q) => `${yen(q.jpy)}${q.capHit ? '（上限）' : ''}`), r.costCapFromMinutes == null ? '600分まで当たらない' : `${r.costCapFromMinutes}分`])));
  L.push('', '### テキスト（1回の上限いっぱいのトークン・安全係数込み）', '');
  L.push(table(['モデル', '為替', '円／回', ...res.textUnit[0].perQuota.map((q) => `${q.quota}回`)],
    res.textUnit.map((r) => [r.label, `¥${r.fx}`, r.yenPerRequest.toFixed(3), ...r.perQuota.map((q) => yen(q.jpy))])));
  L.push('');

  L.push('## 2. 価格・音声の枠・プランごとの1人の月次（有料1年目の手数料）', '');
  L.push(table(['月額／年額', '音声枠', 'プラン', '手数料', '利用', '受取', 'AI原価', '貢献利益', `紹介${pct(res.focusReferralRate)}後（貢献基準）`, '受取比', '（契約基準）', '受取比'],
    res.matrix.map((m) => [`${m.pricePair[0]}／${m.pricePair[1]}`, `${m.voiceQuota}分${m.unit.voice.capHit ? `⚠${Math.round(m.unit.voice.servedShare * 100)}%` : ''}`, PLAN[m.plan], fee(m.storeFee), USAGE[m.usage] ?? m.usage,
      yen(m.unit.proceeds), yen(m.unit.ai), yen(m.unit.contribution), yen(m.withReferral.afterReward), pct(m.withReferral.marginOfProceeds), yen(m.withReferralContract.afterReward), pct(m.withReferralContract.marginOfProceeds)])));
  L.push('', '年額は月換算。年額でもAIの枠は毎月更新される前提で、12か月分の原価を計上している。', '');

  L.push('## 3. 全員が毎月上限まで使った時（注目の組み合わせ・紹介報酬控除後・1か月あたり）', '');
  const head = res.capByProvider[0].cells.map((c) => `${PLAN[c.plan]}・${fee(c.storeFee)}`);
  const capLine = (r) => [r.label, ...r.cells.map((c) => `${yen(c.afterReward)}（${pct(c.margin)}）／${yen(c.afterRewardContract)}（${pct(c.marginContract)}）${c.servedShare < 1 ? `⚠提供${Math.round(c.servedShare * 100)}%` : ''}`)];
  L.push('### 事業者×為替', '', table(['事業者・為替', ...head], res.capByProvider.map(capLine)), '');
  if (res.capStress.length) L.push('### ストレス', '', table(['ケース', ...head], res.capStress.map(capLine)), '');
  L.push('各欄は「貢献基準の報酬後（受取比）／契約基準の報酬後（受取比）」。⚠は中継の原価上限が先に効き、宣伝した分数を最後まで提供できないこと（利益ではなく商品の問題）。', '');

  L.push(`## 4. 紹介報酬（獲得した有料契約者1人・${res.horizonMonths}か月の期待値）`, '');
  L.push(table(['プラン', '利用', '方式', '率', '報酬前', '報酬', '報酬後', '報酬÷報酬前', '赤字の課金'],
    res.referral.map((r) => [PLAN[r.plan], USAGE[r.usage] ?? r.usage, SCHEME[r.scheme], pct(r.rate), yen(r.before), yen(r.reward), yen(r.after), pct(r.rewardShare), r.minPeriodAfterReward < 0 ? 'あり' : 'なし'])));
  L.push('', '方式は en-partner-hub の commission_scope と同じ考え方：年額では「初回のみ」と「初年度のみ」が同じ1回の課金になる。基準は貢献利益（利用者ごとの実原価を引いた額）。', '');
  L.push(`### 報酬の基準の違い（${pct(res.focusReferralRate)}・継続）`, '');
  L.push(table(['プラン', '利用', '貢献利益の基準', '契約の固定控除の基準', '受取の基準（控除なし）', '固定控除で払い過ぎ'],
    res.referralBasis.map((r) => [PLAN[r.plan], USAGE[r.usage] ?? r.usage, yen(r.contribution.reward), yen(r.contract.reward), yen(r.proceeds.reward), yen(r.contract.reward - r.contribution.reward)])));
  L.push('', 'en-partner-hub は利用者ごとのAI原価を持たない。計算できるのは「推定受取−契約で合意した固定の控除（1か月あたり×カバー月数）」まで。高利用の紹介利用者では、固定控除の基準が貢献利益の基準より多く払う。', '');
  L.push('### 紹介経由の継続率が低い場合（標準の利用）', '');
  L.push(table(['プラン', '解約の倍率', '通常の報酬後', '紹介経由の報酬後'], res.referralChurn.map((r) => [PLAN[r.plan], `${r.multiplier}倍`, yen(r.normal.afterReward), yen(r.referred.afterReward)])));
  L.push('');

  L.push('## 5. 損益分岐（月額・年額の構成比で混ぜた1人の月次）', '');
  const tierHead = res.breakEven[0].tiers.map((t) => `固定 ${yen(t.fixed)}円（〜${t.upToSubscribers ?? '上限なし'}人）`);
  const BASIS = { contribution: '貢献', contract: '契約' };
  const POS = { within: '', above: '（段を超える）', below: '（段の下限で黒字）', never: '' };
  L.push(table(['手数料', '利用', '紹介', '1人の月次', ...tierHead],
    res.breakEven.map((r) => [fee(r.storeFee), USAGE[r.usage] ?? r.usage, r.rate > 0 ? `${pct(r.rate)}（${BASIS[r.basis]}）` : 'なし', yen(r.perSubscriber), ...r.tiers.map((t) => (t.subscribers == null ? '回収不可' : `${t.subscribers.toLocaleString('en-US')}人${POS[t.position]}`))])));
  L.push('', '固定費は契約者数の段で増える仮定なので、段ごとに見る。「段を超える」はその段の中では回収できない。「段の下限で黒字」はその段に入った時点で既に回収できている。', '');

  L.push(`## 6. 許容できる音声の枠（全員が上限まで使い、紹介${pct(res.focusReferralRate)}後の受取比が ${pct(res.targetMargin)} 以上に残る最大の分）`, '');
  const LIM = { cost_cap: '原価上限', margin: '利益率', search_limit: '探索の上限' };
  const mm = (x) => (x == null ? '0分でも不足' : `${x}分`);
  L.push(table(['事業者', '為替', 'プラン', '手数料', '最大の枠（貢献基準）', '決め手', '最大の枠（契約基準）', '決め手', '原価上限に当たる分'],
    res.allowedQuota.map((r) => [vp(r.provider), `¥${r.fx}`, PLAN[r.plan], fee(r.storeFee), mm(r.maxMinutes), LIM[r.limitedBy], mm(r.maxMinutesContract), LIM[r.limitedByContract], r.costCapFromMinutes == null ? '−' : `${r.costCapFromMinutes}分`])));
  L.push('', `テキストは ${res.focus.textQuota}回を上限まで使う前提。有料1年目の手数料で計算（1年を超えた購読は手数料が下がり、余裕が増える）。`, '');

  L.push('## 前提と出所', '');
  L.push(table(['項目', '値', '確度', '出所'], res.provenance.map((p) => [`\`${p.path}\``, typeof p.value === 'object' ? JSON.stringify(p.value) : String(p.value), STATUS[p.status] ?? p.status, String(p.source ?? '').replace(/\|/g, '／')])));
  L.push('');
  return L.join('\n');
}
