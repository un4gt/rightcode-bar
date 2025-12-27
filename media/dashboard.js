(() => {
	const vscode = acquireVsCodeApi();

	function isRecord(value) {
		return typeof value === 'object' && value !== null;
	}

	const AUTO_REFRESH_SECONDS = 60;
	const MODEL_COLORS = [
		'var(--rc-purple-500)',
		'var(--rc-orange-500)',
		'var(--rc-green-500)',
		'var(--rc-orange-400)',
		'var(--rc-purple-600)',
	];

	function formatNumber(value) {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			return '-';
		}
		return value.toLocaleString('en-US');
	}

	function formatQuota(value) {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			return '-';
		}
		return value.toFixed(2);
	}

	function formatCompactNumber(value) {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			return '-';
		}
		const abs = Math.abs(value);
		if (abs >= 1e9) {
			return `${(value / 1e9).toFixed(2)}B`;
		}
		if (abs >= 1e6) {
			return `${(value / 1e6).toFixed(2)}M`;
		}
		if (abs >= 1e3) {
			return `${(value / 1e3).toFixed(2)}K`;
		}
		return value.toFixed(0);
	}

	function formatMoney(value, decimals) {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			return '-';
		}
		const fixed = value.toFixed(typeof decimals === 'number' ? decimals : 2);
		return `$${fixed}`;
	}

	function formatTokenCount(value) {
		return formatCompactNumber(value);
	}

	function pad2(value) {
		return String(value).padStart(2, '0');
	}

	function toApiDateTime(date) {
		return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
	}

	function toDisplayDateTime(date) {
		return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
	}

	function startOfDay(date) {
		return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
	}

	function endOfDay(date) {
		return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 0);
	}

	function addDays(date, days) {
		const next = new Date(date);
		next.setDate(next.getDate() + days);
		return next;
	}

	function isOneOf(value, list) {
		return list.includes(value);
	}

	function formatDateYmd(dateTime) {
		if (!dateTime) {
			return '-';
		}

		const datePart = String(dateTime).split('T')[0] || '';
		const parts = datePart.split('-');
		if (parts.length !== 3) {
			return datePart;
		}
		const [year, month, day] = parts;
		if (!year || !month || !day) {
			return datePart;
		}
		return `${year}/${month}/${day}`;
	}

	function formatDateMd(dateTime) {
		if (!dateTime) {
			return '-';
		}

		const datePart = String(dateTime).split('T')[0] || '';
		const parts = datePart.split('-');
		if (parts.length !== 3) {
			return datePart;
		}
		const [, month, day] = parts;
		if (!month || !day) {
			return datePart;
		}
		return `${month}/${day}`;
	}

	function escapeHtml(value) {
		return String(value).replace(/[&<>"']/g, (ch) => {
			switch (ch) {
				case '&':
					return '&amp;';
				case '<':
					return '&lt;';
				case '>':
					return '&gt;';
				case '"':
					return '&quot;';
				case "'":
					return '&#39;';
				default:
					return ch;
			}
		});
	}

	function setText(id, value) {
		const element = document.getElementById(id);
		if (!element) {
			return;
		}
		element.textContent = value;
	}

	function nowText() {
		return new Date().toLocaleString();
	}

	let subscriptionIndex = 0;
	let subscriptionCount = 0;
	let subscriptionsLoading = false;
	let usageLoading = false;
	let autoRefreshHandle = undefined;

	const usageState = {
		granularity: 'day',
		range: '7d',
	};

	function setSubscriptionsLoading(isLoading) {
		const track = document.getElementById('subsTrack');
		const dots = document.getElementById('subsDots');
		const hint = document.getElementById('subsHint');
		const prevBtn = document.getElementById('subsPrevBtn');
		const nextBtn = document.getElementById('subsNextBtn');
		const refreshBtn = document.getElementById('subsRefreshBtn');

		subscriptionsLoading = isLoading;
		if (refreshBtn instanceof HTMLButtonElement) {
			refreshBtn.disabled = isLoading;
			refreshBtn.textContent = isLoading ? '加载中…' : '刷新';
		}

		if (prevBtn instanceof HTMLButtonElement) {
			prevBtn.disabled = true;
		}
		if (nextBtn instanceof HTMLButtonElement) {
			nextBtn.disabled = true;
		}

		if (track && isLoading) {
			track.style.transform = 'translateX(0)';
			track.innerHTML = `<div class="carousel__slide">
	<div class="subscription-card">
		<div class="subscription-card__name">加载中…</div>
		<div class="hint">正在获取订阅列表。</div>
	</div>
</div>`;
		}
		if (dots) {
			dots.innerHTML = '';
		}
		if (hint instanceof HTMLElement) {
			hint.style.display = 'none';
		}
	}

	function requestSubscriptions() {
		if (subscriptionsLoading) {
			return;
		}
		setSubscriptionsLoading(true);
		vscode.postMessage({ type: 'rightcodeBar.dashboard.requestSubscriptions' });
	}

	function renderSubscriptionsError(message) {
		const track = document.getElementById('subsTrack');
		const dots = document.getElementById('subsDots');
		const hint = document.getElementById('subsHint');
		const prevBtn = document.getElementById('subsPrevBtn');
		const nextBtn = document.getElementById('subsNextBtn');
		const refreshBtn = document.getElementById('subsRefreshBtn');

		subscriptionCount = 0;
		subscriptionIndex = 0;
		if (refreshBtn instanceof HTMLButtonElement) {
			refreshBtn.disabled = false;
			refreshBtn.textContent = '刷新';
		}

		if (prevBtn instanceof HTMLButtonElement) {
			prevBtn.disabled = true;
		}
		if (nextBtn instanceof HTMLButtonElement) {
			nextBtn.disabled = true;
		}

		if (track) {
			track.style.transform = 'translateX(0)';
			track.innerHTML = `<div class="carousel__slide">
	<div class="subscription-card">
		<div class="subscription-card__name">获取订阅失败</div>
		<div class="hint">${escapeHtml(message || '')}</div>
	</div>
</div>`;
		}
		if (dots) {
			dots.innerHTML = '';
		}
		if (hint instanceof HTMLElement) {
			hint.style.display = 'none';
		}
	}

	function renderSubscriptions(subscriptions) {
		const track = document.getElementById('subsTrack');
		const dots = document.getElementById('subsDots');
		const hint = document.getElementById('subsHint');
		const prevBtn = document.getElementById('subsPrevBtn');
		const nextBtn = document.getElementById('subsNextBtn');

		if (!track || !dots || !prevBtn || !nextBtn) {
			return;
		}

		subscriptionsLoading = false;
		const refreshBtn = document.getElementById('subsRefreshBtn');
		if (refreshBtn instanceof HTMLButtonElement) {
			refreshBtn.disabled = false;
			refreshBtn.textContent = '刷新';
		}

		if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
			track.innerHTML = `<div class="carousel__slide"><div class="subscription-card"><div class="subscription-card__name">暂无订阅</div></div></div>`;
			dots.innerHTML = '';
			prevBtn.disabled = true;
			nextBtn.disabled = true;
			subscriptionCount = 0;
			subscriptionIndex = 0;
			if (hint instanceof HTMLElement) {
				hint.style.display = 'none';
			}
			return;
		}

		subscriptionCount = subscriptions.length;
		subscriptionIndex = Math.min(subscriptionIndex, subscriptionCount - 1);

		track.innerHTML = subscriptions
			.map((sub) => {
				const remaining = Number(sub.remainingQuota) || 0;
				const total = Number(sub.totalQuota) || 0;
				let used = total - remaining;
				if (used < 0 && used > -1e-8) {
					used = 0;
				}
				const ratio = total > 0 ? Math.max(0, Math.min(1, used / total)) : 0;
				const percent = Math.round(ratio * 1000) / 10;
				const badgeText = sub.resetToday ? '今日已重置' : '有效';
				const badgeStyle = sub.resetToday ? 'background: rgba(34, 197, 94, 0.16); border-color: rgba(34, 197, 94, 0.32);' : '';

				return `<div class="carousel__slide">
	<div class="subscription-card">
		<div class="subscription-card__top">
			<div class="subscription-card__name">${escapeHtml(sub.name)}</div>
			<div class="badge" style="${badgeStyle}">${escapeHtml(badgeText)}</div>
		</div>

		<div class="subscription-card__quota">
			<div class="subscription-card__quota-label">剩余</div>
			<div class="subscription-card__quota-value"><span class="subscription-card__currency">$</span>${formatQuota(remaining)}</div>
		</div>

		<div class="progress" aria-label="使用进度">
			<div class="progress__fill" style="width: ${percent}%;"></div>
		</div>

		<div class="subscription-meta" aria-label="订阅详情">
			<div class="subscription-meta__item">
				<div class="subscription-meta__k">总额</div>
				<div class="subscription-meta__v">$${formatQuota(total)}</div>
			</div>
			<div class="subscription-meta__item">
				<div class="subscription-meta__k">已用</div>
				<div class="subscription-meta__v">$${formatQuota(used)}</div>
			</div>
			<div class="subscription-meta__item">
				<div class="subscription-meta__k">到期</div>
				<div class="subscription-meta__v">${escapeHtml(formatDateYmd(sub.expiredAt))}</div>
			</div>
			<div class="subscription-meta__item">
				<div class="subscription-meta__k">上次重置</div>
				<div class="subscription-meta__v">${escapeHtml(formatDateMd(sub.lastResetAt))}</div>
			</div>
		</div>
	</div>
</div>`;
			})
			.join('');

		dots.innerHTML = subscriptions
			.map((_, index) => `<span class="dot${index === subscriptionIndex ? ' is-active' : ''}"></span>`)
			.join('');

		const hasMultiple = subscriptions.length > 1;
		prevBtn.disabled = !hasMultiple;
		nextBtn.disabled = !hasMultiple;
		if (!hasMultiple) {
			dots.style.display = 'none';
		} else {
			dots.style.display = '';
		}
		if (hint instanceof HTMLElement) {
			hint.style.display = 'none';
		}

		updateSubscriptionPosition();
	}

	function updateSubscriptionPosition() {
		const track = document.getElementById('subsTrack');
		const dots = document.getElementById('subsDots');
		if (!track || !dots) {
			return;
		}

		if (subscriptionCount <= 0) {
			return;
		}

		subscriptionIndex = ((subscriptionIndex % subscriptionCount) + subscriptionCount) % subscriptionCount;
		track.style.transform = `translateX(${-subscriptionIndex * 100}%)`;

		Array.from(dots.children).forEach((node, idx) => {
			if (!(node instanceof HTMLElement)) {
				return;
			}
			node.classList.toggle('is-active', idx === subscriptionIndex);
		});
	}

	function bindCarouselControls() {
		const prevBtn = document.getElementById('subsPrevBtn');
		const nextBtn = document.getElementById('subsNextBtn');
		const viewport = document.querySelector('.carousel__viewport');

		if (!(prevBtn instanceof HTMLButtonElement) || !(nextBtn instanceof HTMLButtonElement)) {
			return;
		}

		prevBtn.addEventListener('click', () => {
			subscriptionIndex -= 1;
			updateSubscriptionPosition();
		});

		nextBtn.addEventListener('click', () => {
			subscriptionIndex += 1;
			updateSubscriptionPosition();
		});

		viewport?.addEventListener('keydown', (event) => {
			if (!(event instanceof KeyboardEvent)) {
				return;
			}

			if (event.key === 'ArrowLeft') {
				subscriptionIndex -= 1;
				updateSubscriptionPosition();
				event.preventDefault();
			}

			if (event.key === 'ArrowRight') {
				subscriptionIndex += 1;
				updateSubscriptionPosition();
				event.preventDefault();
			}
		});
	}

	function setUsageLoading(isLoading) {
		usageLoading = isLoading;
		const refreshBtn = document.getElementById('refreshBtn');
		if (refreshBtn instanceof HTMLButtonElement) {
			refreshBtn.disabled = isLoading;
			refreshBtn.textContent = isLoading ? '加载中…' : '刷新';
		}
	}

	function getUsageDateRange() {
		const now = new Date();
		let start = startOfDay(now);
		let end = endOfDay(now);

		if (usageState.granularity === 'day') {
			if (usageState.range === 'today') {
				start = startOfDay(now);
				end = endOfDay(now);
			} else if (usageState.range === '7d') {
				start = startOfDay(addDays(now, -6));
				end = endOfDay(now);
			} else if (usageState.range === '30d') {
				start = startOfDay(addDays(now, -29));
				end = endOfDay(now);
			}
		} else {
			if (usageState.range === 'today') {
				start = startOfDay(now);
				end = endOfDay(now);
			} else if (usageState.range === 'yesterday') {
				start = startOfDay(addDays(now, -1));
				end = endOfDay(addDays(now, -1));
			} else if (usageState.range === '2d') {
				start = startOfDay(addDays(now, -2));
				end = endOfDay(addDays(now, -2));
			}
		}

		const startDate = toApiDateTime(start);
		const endDate = toApiDateTime(end);
		const displayText = `${toDisplayDateTime(start)}  -  ${toDisplayDateTime(end)}`;
		return { startDate, endDate, displayText };
	}

	function requestUsageStats() {
		if (usageLoading) {
			return;
		}

		setUsageLoading(true);
		const range = getUsageDateRange();
		setText('dateRangeText', range.displayText);

		vscode.postMessage({
			type: 'rightcodeBar.dashboard.requestUsageStats',
			granularity: usageState.granularity,
			startDate: range.startDate,
			endDate: range.endDate,
		});
	}

	function renderUsageError(message) {
		setUsageLoading(false);
		setText('metricRequests', '-');
		setText('metricTokens', '-');
		setText('metricCost', '-');

		const legend = document.getElementById('legend');
		if (legend instanceof HTMLElement) {
			legend.innerHTML = `<div class="legend-item"><div class="legend-item__left"><span class="legend-name">获取失败</span></div><div class="legend-meta">${escapeHtml(message || '')}</div></div>`;
		}

		renderDonut([]);
		renderTable([]);
	}

	function buildDistributionItems(stats) {
		const totalTokens = Number(stats?.totalTokens) || 0;
		const details = Array.isArray(stats?.detailsByModel) ? stats.detailsByModel : [];

		return [...details]
			.sort((a, b) => (Number(b?.totalTokens) || 0) - (Number(a?.totalTokens) || 0))
			.map((detail, index) => {
				const tokens = Number(detail?.totalTokens) || 0;
				const ratio = totalTokens > 0 ? (tokens / totalTokens) * 100 : 0;
				const color = MODEL_COLORS[index % MODEL_COLORS.length] || 'rgba(255,255,255,0.20)';
				return {
					model: String(detail?.model || ''),
					requests: Number(detail?.requests) || 0,
					tokens: formatTokenCount(tokens),
					cost: formatMoney(Number(detail?.totalCost) || 0, 6),
					ratio,
					color,
				};
			});
	}

	function renderUsageStats(stats, startDate, endDate) {
		setUsageLoading(false);

		if (!stats || typeof stats !== 'object') {
			renderUsageError('Invalid response');
			return;
		}

		const totalRequests = Number(stats.totalRequests) || 0;
		const totalTokens = Number(stats.totalTokens) || 0;
		const totalCost = Number(stats.totalCost) || 0;

		setText('metricRequests', formatNumber(totalRequests));
		setText('metricTokens', formatTokenCount(totalTokens));
		setText('metricCost', formatMoney(totalCost, 2));

		if (typeof startDate === 'string' && typeof endDate === 'string') {
			const startText = formatDateTimeText(startDate);
			const endText = formatDateTimeText(endDate);
			if (startText && endText) {
				setText('dateRangeText', `${startText}  -  ${endText}`);
			}
		}

		const items = buildDistributionItems(stats);
		renderDonut(items);
		renderTable(items);
	}

	function formatDateTimeText(apiDateTime) {
		if (typeof apiDateTime !== 'string' || apiDateTime.length < 16) {
			return '';
		}
		const [datePart, timePart] = apiDateTime.split('T');
		if (!datePart || !timePart) {
			return '';
		}
		const [year, month, day] = datePart.split('-');
		if (!year || !month || !day) {
			return '';
		}
		const hm = timePart.slice(0, 5);
		return `${year}/${month}/${day} ${hm}`;
	}

	function renderDonut(items) {
		const donut = document.getElementById('donut');
		const legend = document.getElementById('legend');
		if (!(donut instanceof HTMLElement) || !(legend instanceof HTMLElement)) {
			return;
		}

		if (!Array.isArray(items) || items.length === 0) {
			donut.style.background = 'conic-gradient(rgba(255,255,255,0.10) 0 100%)';
			legend.innerHTML = '<div class="legend-item"><div class="legend-item__left"><span class="legend-name">暂无数据</span></div></div>';
			return;
		}

		let current = 0;
		const parts = items.map((item) => {
			const start = current;
			const end = Math.min(100, start + (Number(item.ratio) || 0));
			current = end;
			const color = item.color || 'rgba(255,255,255,0.20)';
			return `${color} ${start}% ${end}%`;
		});

		donut.style.background = `conic-gradient(${parts.join(',')})`;

		legend.innerHTML = items
			.map((item) => {
				const ratio = Number(item.ratio) || 0;
				return `<div class="legend-item">
	<div class="legend-item__left">
		<span class="legend-swatch" style="background: ${escapeHtml(item.color || 'rgba(255,255,255,0.20)')}"></span>
		<span class="legend-name">${escapeHtml(item.model)}</span>
	</div>
	<div class="legend-meta">${ratio.toFixed(1)}%</div>
</div>`;
			})
			.join('');
	}

	function renderTable(items) {
		const body = document.getElementById('detailsTableBody');
		if (!body) {
			return;
		}

		if (!Array.isArray(items) || items.length === 0) {
			body.innerHTML = '<tr><td colspan="5">暂无数据</td></tr>';
			return;
		}

		body.innerHTML = items
			.map((item) => {
				const ratio = Number(item.ratio) || 0;
				return `<tr>
	<td>${escapeHtml(item.model)}</td>
	<td class="num">${formatNumber(item.requests)}</td>
	<td class="num token">${escapeHtml(item.tokens)}</td>
	<td class="num">${escapeHtml(item.cost)}</td>
	<td class="num">${ratio.toFixed(1)}%</td>
</tr>`;
			})
			.join('');
	}

	function syncToolbarState() {
		document.body.dataset.granularity = usageState.granularity;

		document.querySelectorAll('button.pill[data-granularity]:not([data-range])').forEach((btn) => {
			if (!(btn instanceof HTMLButtonElement)) {
				return;
			}
			btn.classList.toggle('is-active', btn.dataset.granularity === usageState.granularity);
		});

		document.querySelectorAll('button.pill[data-range]').forEach((btn) => {
			if (!(btn instanceof HTMLButtonElement)) {
				return;
			}
			btn.classList.toggle('is-active', btn.dataset.range === usageState.range);
		});
	}

	function setUsageGranularity(granularity) {
		if (granularity !== 'day' && granularity !== 'hour') {
			return;
		}

		usageState.granularity = granularity;

		if (granularity === 'day' && !isOneOf(usageState.range, ['today', '7d', '30d'])) {
			usageState.range = '7d';
		}
		if (granularity === 'hour' && !isOneOf(usageState.range, ['today', 'yesterday', '2d'])) {
			usageState.range = 'today';
		}

		syncToolbarState();
		requestUsageStats();
	}

	function setUsageRange(range) {
		if (usageState.granularity === 'day' && !isOneOf(range, ['today', '7d', '30d'])) {
			return;
		}
		if (usageState.granularity === 'hour' && !isOneOf(range, ['today', 'yesterday', '2d'])) {
			return;
		}

		usageState.range = range;
		syncToolbarState();
		requestUsageStats();
	}

	function setAutoRefresh(isOn) {
		if (autoRefreshHandle !== undefined) {
			clearInterval(autoRefreshHandle);
			autoRefreshHandle = undefined;
		}

		const toggle = document.getElementById('autoRefreshToggle');
		if (toggle instanceof HTMLButtonElement) {
			toggle.classList.toggle('is-on', isOn);
			toggle.setAttribute('aria-checked', isOn ? 'true' : 'false');
		}

		if (!isOn) {
			return;
		}

		autoRefreshHandle = setInterval(() => {
			requestUsageStats();
		}, AUTO_REFRESH_SECONDS * 1000);
	}

	function bindToolbar() {
		document.querySelectorAll('button.pill[data-granularity]:not([data-range])').forEach((btn) => {
			btn.addEventListener('click', () => {
				if (!(btn instanceof HTMLButtonElement)) {
					return;
				}
				setUsageGranularity(btn.dataset.granularity);
			});
		});

		document.querySelectorAll('button.pill[data-range]').forEach((btn) => {
			btn.addEventListener('click', () => {
				if (!(btn instanceof HTMLButtonElement)) {
					return;
				}
				setUsageRange(btn.dataset.range || '');
			});
		});

		const refreshBtn = document.getElementById('refreshBtn');
		refreshBtn?.addEventListener('click', requestUsageStats);

		const subsRefreshBtn = document.getElementById('subsRefreshBtn');
		subsRefreshBtn?.addEventListener('click', requestSubscriptions);

		const toggle = document.getElementById('autoRefreshToggle');
		toggle?.addEventListener('click', () => {
			if (!(toggle instanceof HTMLButtonElement)) {
				return;
			}

			const isOn = !toggle.classList.contains('is-on');
			setAutoRefresh(isOn);
		});
	}

	function init() {
		setText('lastUpdatedText', `最后刷新：${nowText()}`);
		document.body.dataset.granularity = usageState.granularity;
		syncToolbarState();
		bindCarouselControls();
		requestSubscriptions();
		requestUsageStats();
		bindToolbar();
	}

	window.addEventListener('message', (event) => {
		const message = event.data;
		if (!isRecord(message)) {
			return;
		}

		if (message.type === 'rightcodeBar.dashboard.subscriptions') {
			setSubscriptionsLoading(false);
			if (message.ok === true) {
				renderSubscriptions(message.subscriptions || []);
				if (message.refreshedAt) {
					setText('lastUpdatedText', `最后刷新：${new Date(message.refreshedAt).toLocaleString()}`);
				}
			} else {
				renderSubscriptionsError(message.error || 'Unknown error');
			}
		}

		if (message.type === 'rightcodeBar.dashboard.usageStats') {
			if (message.ok === true) {
				renderUsageStats(message.stats, message.startDate, message.endDate);
				if (message.refreshedAt) {
					setText('lastUpdatedText', `最后刷新：${new Date(message.refreshedAt).toLocaleString()}`);
				}
			} else {
				renderUsageError(message.error || 'Unknown error');
			}
		}
	});

	window.addEventListener('DOMContentLoaded', init);
})();
