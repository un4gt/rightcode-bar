import * as vscode from 'vscode';

type RightCodeSubscription = {
	id: number;
	name: string;
	userId?: number;
	itemId?: number;
	tierId?: number;
	totalQuota: number;
	remainingQuota: number;
	durationHours?: number;
	expiredAt?: string;
	lastResetAt?: string | null;
	createdAt?: string;
	updatedAt?: string;
	resetToday?: boolean;
};

type SubscriptionListResult = {
	total: number;
	subscriptions: RightCodeSubscription[];
};

type RightCodeUseLogTrendItem = {
	date: string;
	requests: number;
	cost: number;
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
};

type RightCodeUseLogModelDetails = {
	model: string;
	requests: number;
	totalTokens: number;
	totalCost: number;
};

type RightCodeUseLogAdvancedStats = {
	trend: RightCodeUseLogTrendItem[];
	totalRequests: number;
	totalCost: number;
	totalTokens: number;
	tokensByModel: Record<string, number>;
	detailsByModel: RightCodeUseLogModelDetails[];
};

type RightCodeAuthContext = {
	token: string;
	accountLabel: string;
	accountAlias?: string;
};

type RightCodeAccountConfig = {
	alias: string;
	token: string;
};

type RightCodeLoginResult = {
	userToken: string;
	username?: string;
	email?: string;
};

const RIGHTCODE_SUBSCRIPTIONS_URL = 'https://right.codes/subscriptions/list';
const RIGHTCODE_USE_LOG_ADVANCED_URL = 'https://right.codes/use-log/stats/advanced';
const RIGHTCODE_AUTH_LOGIN_URL = 'https://right.codes/auth/login';
const RIGHTCODE_REFERER = 'https://right.codes/dashboard';
const RIGHTCODE_LOGIN_REFERER = 'https://right.codes/login';
const DEFAULT_USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:146.0) Gecko/20100101 Firefox/146.0';
const STATUS_TEXT_ERROR = '获取订阅失败，请检查 token';
const STATUS_TEXT_DASHBOARD_ERROR = '获取数据失败，请检查 token';

const COMMAND_REFRESH = 'rightcode-bar.refresh';
const COMMAND_OPEN_SETTINGS = 'rightcode-bar.openSettings';
const COMMAND_ACCOUNT_ADD = 'rightcode-bar.account.add';
const COMMAND_ACCOUNT_SWITCH = 'rightcode-bar.account.switch';
const DEFAULT_ACCOUNT_ALIAS = 'default';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function parseFiniteNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return undefined;
}

function parseString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function parseAccountsConfig(raw: unknown): RightCodeAccountConfig[] {
	if (Array.isArray(raw)) {
		const accounts: RightCodeAccountConfig[] = [];
		for (const item of raw) {
			if (!isRecord(item)) {
				continue;
			}

			const alias = parseString(item.alias ?? item.label)?.trim() ?? '';
			const token = normalizeTokenInput(parseString(item.token) ?? '');
			if (!alias || !token) {
				continue;
			}

			accounts.push({ alias, token });
		}
		return accounts;
	}

	if (isRecord(raw)) {
		const accounts: RightCodeAccountConfig[] = [];
		for (const [aliasRaw, tokenRaw] of Object.entries(raw)) {
			if (typeof tokenRaw !== 'string') {
				continue;
			}

			const alias = aliasRaw.trim();
			const token = normalizeTokenInput(tokenRaw);
			if (!alias || !token) {
				continue;
			}

			accounts.push({ alias, token });
		}
		return accounts;
	}

	return [];
}

function uniqAccountsByAlias(accounts: RightCodeAccountConfig[]): RightCodeAccountConfig[] {
	const seen = new Set<string>();
	const result: RightCodeAccountConfig[] = [];
	for (const account of accounts) {
		if (seen.has(account.alias)) {
			continue;
		}
		seen.add(account.alias);
		result.push(account);
	}
	return result;
}

function normalizeTokenInput(value: string): string {
	let normalized = value.trim();
	normalized = normalized.replace(/^authorization\s*:\s*/i, '');
	normalized = normalized.replace(/^bearer\s+/i, '');
	normalized = normalized.trim();
	if (
		(normalized.startsWith('"') && normalized.endsWith('"')) ||
		(normalized.startsWith("'") && normalized.endsWith("'"))
	) {
		normalized = normalized.slice(1, -1).trim();
	}
	return normalized;
}

function escapeTableCell(value: string): string {
	return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function formatQuota(value: number): string {
	return value.toFixed(2);
}

function formatDateYmd(dateTime: string | undefined): string {
	if (!dateTime) {
		return '-';
	}

	const datePart = dateTime.split('T')[0] ?? '';
	const [year, month, day] = datePart.split('-');
	if (!year || !month || !day) {
		return escapeTableCell(datePart || dateTime);
	}
	return `${year}/${month}/${day}`;
}

function formatDateMd(dateTime: string | undefined): string {
	if (!dateTime) {
		return '-';
	}

	const datePart = dateTime.split('T')[0] ?? '';
	const [, month, day] = datePart.split('-');
	if (!month || !day) {
		return escapeTableCell(datePart || dateTime);
	}
	return `${month}/${day}`;
}

function formatBooleanYesNo(value: boolean | undefined): string {
	if (value === undefined) {
		return '-';
	}
	return value ? '是' : '否';
}

function usedQuota(subscription: RightCodeSubscription): number {
	const used = subscription.totalQuota - subscription.remainingQuota;
	return used < 0 && used > -1e-8 ? 0 : used;
}

function pickDisplaySubscription(subscriptions: RightCodeSubscription[]): RightCodeSubscription | undefined {
	return [...subscriptions].sort((a, b) => usedQuota(a) - usedQuota(b))[0];
}

function parseDateTimeMs(value: string): number | undefined {
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}

	const parsed = Date.parse(trimmed);
	if (!Number.isFinite(parsed)) {
		return undefined;
	}
	return parsed;
}

function isSubscriptionExpired(subscription: Pick<RightCodeSubscription, 'expiredAt'>, nowMs: number): boolean {
	if (!subscription.expiredAt) {
		return false;
	}

	const expiredAtMs = parseDateTimeMs(subscription.expiredAt);
	if (expiredAtMs === undefined) {
		return false;
	}

	return nowMs >= expiredAtMs;
}

function filterExpiredSubscriptions(
	subscriptions: RightCodeSubscription[],
	params: { showExpiredSubscriptions: boolean },
): RightCodeSubscription[] {
	if (params.showExpiredSubscriptions) {
		return subscriptions;
	}

	const nowMs = Date.now();
	return subscriptions.filter((subscription) => !isSubscriptionExpired(subscription, nowMs));
}

function parseSubscription(raw: unknown): RightCodeSubscription | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}

	const id = parseFiniteNumber(raw.id);
	const name = parseString(raw.name);
	const totalQuota = parseFiniteNumber(raw.total_quota);
	const remainingQuota = parseFiniteNumber(raw.remaining_quota);
	if (id === undefined || name === undefined || totalQuota === undefined || remainingQuota === undefined) {
		return undefined;
	}

	const lastResetAtRaw = raw.last_reset_at;
	const lastResetAt =
		lastResetAtRaw === null ? null : lastResetAtRaw === undefined ? undefined : parseString(lastResetAtRaw);

	return {
		id,
		name,
		userId: parseFiniteNumber(raw.user_id),
		itemId: parseFiniteNumber(raw.item_id),
		tierId: parseFiniteNumber(raw.tier_id),
		totalQuota,
		remainingQuota,
		durationHours: parseFiniteNumber(raw.duration_hours),
		expiredAt: parseString(raw.expired_at),
		lastResetAt,
		createdAt: parseString(raw.created_at),
		updatedAt: parseString(raw.updated_at),
		resetToday: parseBoolean(raw.reset_today),
	};
}

function parseSubscriptionListResult(raw: unknown): SubscriptionListResult {
	if (!isRecord(raw)) {
		throw new Error('Unexpected response: not an object');
	}

	const total = parseFiniteNumber(raw.total) ?? 0;
	const subscriptionsRaw = raw.subscriptions;
	const subscriptions = Array.isArray(subscriptionsRaw)
		? subscriptionsRaw.map(parseSubscription).filter((value): value is RightCodeSubscription => value !== undefined)
		: [];

	return { total, subscriptions };
}

async function fetchSubscriptionList(params: {
	token: string;
	requestTimeoutMs: number;
	output: vscode.OutputChannel;
}): Promise<SubscriptionListResult> {
	const controller = new AbortController();
	const timeoutHandle = setTimeout(() => controller.abort(), params.requestTimeoutMs);

	try {
		const response = await fetch(RIGHTCODE_SUBSCRIPTIONS_URL, {
			method: 'GET',
			headers: {
				Accept: '*/*',
				'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
				'Accept-Encoding': 'gzip, deflate, br',
				'Content-Type': 'application/json',
				'User-Agent': DEFAULT_USER_AGENT,
				Referer: RIGHTCODE_REFERER,
				Authorization: `Bearer ${params.token}`,
				'Sec-GPC': '1',
			},
			signal: controller.signal,
		});

		const responseText = await response.text();
		if (!response.ok) {
			params.output.appendLine(
				`HTTP ${response.status} ${response.statusText} from ${RIGHTCODE_SUBSCRIPTIONS_URL}: ${responseText.slice(0, 200)}`,
			);
			throw new Error(`Request failed: HTTP ${response.status}`);
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(responseText) as unknown;
		} catch {
			params.output.appendLine(
				`Failed to parse JSON from ${RIGHTCODE_SUBSCRIPTIONS_URL}: ${responseText.slice(0, 200)}`,
			);
			throw new Error('Request failed: invalid JSON response');
		}

		return parseSubscriptionListResult(parsed);
	} finally {
		clearTimeout(timeoutHandle);
	}
}

type RightCodeLoginErrorCode = 'INVALID_CREDENTIALS' | 'FORBIDDEN' | 'REQUEST_FAILED' | 'INVALID_RESPONSE';

function createRightCodeLoginError(
	code: RightCodeLoginErrorCode,
	message: string,
): Error & { code: RightCodeLoginErrorCode } {
	const error = new Error(message) as Error & { code: RightCodeLoginErrorCode };
	error.code = code;
	return error;
}

function isRightCodeLoginError(error: unknown): error is Error & { code: RightCodeLoginErrorCode } {
	return error instanceof Error && 'code' in error;
}

function parseLoginResult(raw: unknown): RightCodeLoginResult {
	if (!isRecord(raw)) {
		throw createRightCodeLoginError('INVALID_RESPONSE', 'Unexpected login response: not an object');
	}

	const userToken = parseString(raw.user_token);
	if (!userToken) {
		throw createRightCodeLoginError('INVALID_RESPONSE', 'Unexpected login response: missing user_token');
	}

	return {
		userToken,
		username: parseString(raw.username),
		email: parseString(raw.email),
	};
}

async function fetchLoginByPassword(params: {
	username: string;
	password: string;
	requestTimeoutMs: number;
	output: vscode.OutputChannel;
}): Promise<RightCodeLoginResult> {
	const controller = new AbortController();
	const timeoutHandle = setTimeout(() => controller.abort(), params.requestTimeoutMs);

	try {
		const response = await fetch(RIGHTCODE_AUTH_LOGIN_URL, {
			method: 'POST',
			headers: {
				Accept: '*/*',
				'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
				'Accept-Encoding': 'gzip, deflate, br',
				'Content-Type': 'application/json',
				'User-Agent': DEFAULT_USER_AGENT,
				Origin: 'https://right.codes',
				Referer: RIGHTCODE_LOGIN_REFERER,
				'Sec-GPC': '1',
			},
			body: JSON.stringify({ username: params.username, password: params.password }),
			signal: controller.signal,
		});

		const responseText = await response.text();
		if (!response.ok) {
			params.output.appendLine(`HTTP ${response.status} ${response.statusText} from ${RIGHTCODE_AUTH_LOGIN_URL}`);

			if (response.status === 400 || response.status === 401 || response.status === 422) {
				throw createRightCodeLoginError('INVALID_CREDENTIALS', 'Invalid credentials');
			}

			if (response.status === 403) {
				throw createRightCodeLoginError('FORBIDDEN', 'Login forbidden');
			}

			throw createRightCodeLoginError('REQUEST_FAILED', `Request failed: HTTP ${response.status}`);
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(responseText) as unknown;
		} catch {
			params.output.appendLine(`Failed to parse JSON from ${RIGHTCODE_AUTH_LOGIN_URL}`);
			throw createRightCodeLoginError('INVALID_RESPONSE', 'Login failed: invalid JSON response');
		}

		return parseLoginResult(parsed);
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw createRightCodeLoginError('REQUEST_FAILED', 'Login failed: request timeout');
		}
		throw error;
	} finally {
		clearTimeout(timeoutHandle);
	}
}

function parseUseLogTrendItem(raw: unknown): RightCodeUseLogTrendItem | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}

	const date = parseString(raw.date);
	const requests = parseFiniteNumber(raw.requests);
	const cost = parseFiniteNumber(raw.cost);
	const inputTokens = parseFiniteNumber(raw.input_tokens);
	const outputTokens = parseFiniteNumber(raw.output_tokens);
	const cacheCreationTokens = parseFiniteNumber(raw.cache_creation_tokens);
	const cacheReadTokens = parseFiniteNumber(raw.cache_read_tokens);
	if (
		date === undefined ||
		requests === undefined ||
		cost === undefined ||
		inputTokens === undefined ||
		outputTokens === undefined ||
		cacheCreationTokens === undefined ||
		cacheReadTokens === undefined
	) {
		return undefined;
	}

	return {
		date,
		requests,
		cost,
		inputTokens,
		outputTokens,
		cacheCreationTokens,
		cacheReadTokens,
	};
}

function parseUseLogModelDetails(raw: unknown): RightCodeUseLogModelDetails | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}

	const model = parseString(raw.model);
	const requests = parseFiniteNumber(raw.requests);
	const totalTokens = parseFiniteNumber(raw.total_tokens);
	const totalCost = parseFiniteNumber(raw.total_cost);
	if (model === undefined || requests === undefined || totalTokens === undefined || totalCost === undefined) {
		return undefined;
	}

	return {
		model,
		requests,
		totalTokens,
		totalCost,
	};
}

function parseTokensByModel(raw: unknown): Record<string, number> {
	if (!isRecord(raw)) {
		return {};
	}

	const tokensByModel: Record<string, number> = {};
	for (const [key, value] of Object.entries(raw)) {
		const parsed = parseFiniteNumber(value);
		if (parsed !== undefined) {
			tokensByModel[key] = parsed;
		}
	}
	return tokensByModel;
}

function parseUseLogAdvancedStats(raw: unknown): RightCodeUseLogAdvancedStats {
	if (!isRecord(raw)) {
		throw new Error('Unexpected response: not an object');
	}

	const trendRaw = raw.trend;
	const trend = Array.isArray(trendRaw)
		? trendRaw.map(parseUseLogTrendItem).filter((value): value is RightCodeUseLogTrendItem => value !== undefined)
		: [];

	const totalRequests = parseFiniteNumber(raw.total_requests) ?? 0;
	const totalCost = parseFiniteNumber(raw.total_cost) ?? 0;
	const totalTokens = parseFiniteNumber(raw.total_tokens) ?? 0;
	const tokensByModel = parseTokensByModel(raw.tokens_by_model);

	const detailsRaw = raw.details_by_model;
	const detailsByModel = Array.isArray(detailsRaw)
		? detailsRaw
				.map(parseUseLogModelDetails)
				.filter((value): value is RightCodeUseLogModelDetails => value !== undefined)
		: [];

	return { trend, totalRequests, totalCost, totalTokens, tokensByModel, detailsByModel };
}

async function fetchUseLogAdvancedStats(params: {
	token: string;
	startDate: string;
	endDate: string;
	granularity: 'day' | 'hour';
	requestTimeoutMs: number;
	output: vscode.OutputChannel;
}): Promise<RightCodeUseLogAdvancedStats> {
	const controller = new AbortController();
	const timeoutHandle = setTimeout(() => controller.abort(), params.requestTimeoutMs);

	try {
		const url = new URL(RIGHTCODE_USE_LOG_ADVANCED_URL);
		url.searchParams.set('start_date', params.startDate);
		url.searchParams.set('end_date', params.endDate);
		url.searchParams.set('granularity', params.granularity);

		const response = await fetch(url.toString(), {
			method: 'GET',
			headers: {
				Accept: '*/*',
				'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2',
				'Accept-Encoding': 'gzip, deflate, br',
				'Content-Type': 'application/json',
				'User-Agent': DEFAULT_USER_AGENT,
				Referer: RIGHTCODE_REFERER,
				Authorization: `Bearer ${params.token}`,
				'Sec-GPC': '1',
			},
			signal: controller.signal,
		});

		const responseText = await response.text();
		if (!response.ok) {
			params.output.appendLine(
				`HTTP ${response.status} ${response.statusText} from ${RIGHTCODE_USE_LOG_ADVANCED_URL}: ${responseText.slice(0, 200)}`,
			);
			throw new Error(`Request failed: HTTP ${response.status}`);
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(responseText) as unknown;
		} catch {
			params.output.appendLine(
				`Failed to parse JSON from ${RIGHTCODE_USE_LOG_ADVANCED_URL}: ${responseText.slice(0, 200)}`,
			);
			throw new Error('Request failed: invalid JSON response');
		}

		return parseUseLogAdvancedStats(parsed);
	} finally {
		clearTimeout(timeoutHandle);
	}
}

function buildSuccessTooltip(params: {
	accountLabel: string;
	selected: RightCodeSubscription;
	all: RightCodeSubscription[];
	refreshedAt: Date;
}): vscode.MarkdownString {
	const tooltip = new vscode.MarkdownString(undefined, true);
	tooltip.isTrusted = true;
	tooltip.appendMarkdown(`**RightCode 订阅**\n\n`);
	tooltip.appendMarkdown(
		`当前账号：\`${escapeTableCell(params.accountLabel)}\` ([切换](command:${COMMAND_ACCOUNT_SWITCH}))\n\n`,
	);
	tooltip.appendMarkdown(`| 名称 | 剩余 | 总额 | 已用 | 到期 | 上次重置 | 今日重置 |\n`);
	tooltip.appendMarkdown(`|---|---:|---:|---:|:---:|:---:|:---:|\n`);

	const rows = [...params.all].sort((a, b) => usedQuota(a) - usedQuota(b));
	for (const subscription of rows) {
		const isSelected = subscription.id === params.selected.id;
		const nameCell = isSelected
			? `**${escapeTableCell(subscription.name)}**`
			: escapeTableCell(subscription.name);
		tooltip.appendMarkdown(
			`| ${nameCell} | $${formatQuota(subscription.remainingQuota)} | $${formatQuota(subscription.totalQuota)} | $${formatQuota(usedQuota(subscription))} | ${formatDateYmd(subscription.expiredAt)} | ${formatDateMd(subscription.lastResetAt ?? undefined)} | ${formatBooleanYesNo(subscription.resetToday)} |`,
		);
		tooltip.appendMarkdown(`\n`);
	}

	tooltip.appendMarkdown(`\n最后刷新：${params.refreshedAt.toLocaleString()}\n`);
	tooltip.appendMarkdown(`\n单击状态栏可刷新。\n`);
	return tooltip;
}

function buildMissingConfigTooltip(): vscode.MarkdownString {
	const tooltip = new vscode.MarkdownString(undefined, true);
	tooltip.isTrusted = true;
	tooltip.appendMarkdown(`**RightCode 订阅**\n\n`);
	tooltip.appendMarkdown(`未配置认证信息：\n\n`);
	tooltip.appendMarkdown(`- 推荐：在用户设置中填写 \`rightcodeBar.accounts\`（多账号：别名 + token）\n`);
	tooltip.appendMarkdown(`快捷：([切换账号](command:${COMMAND_ACCOUNT_SWITCH})) / ([打开设置](command:${COMMAND_OPEN_SETTINGS})) / ([添加账号](command:${COMMAND_ACCOUNT_ADD}))\n\n`);
	tooltip.appendMarkdown(`命令面板：\`RightCode: Add Account\` / \`RightCode: Open Settings\`。\n`);
	return tooltip;
}

function buildErrorTooltip(message: string): vscode.MarkdownString {
	const tooltip = new vscode.MarkdownString(undefined, true);
	tooltip.appendMarkdown(`**RightCode 订阅**\n\n`);
	tooltip.appendMarkdown(`${STATUS_TEXT_ERROR}\n\n`);
	tooltip.appendMarkdown(`错误信息：\`${escapeTableCell(message)}\`\n`);
	return tooltip;
}

function buildNoSubscriptionTooltip(refreshedAt: Date): vscode.MarkdownString {
	const tooltip = new vscode.MarkdownString(undefined, true);
	tooltip.appendMarkdown(`**RightCode 订阅**\n\n`);
	tooltip.appendMarkdown(`当前暂无订阅。\n\n`);
	tooltip.appendMarkdown(`最后刷新：${refreshedAt.toLocaleString()}\n`);
	return tooltip;
}

function getConfig(): {
	accounts: RightCodeAccountConfig[];
	activeAccount: string;
	refreshIntervalSeconds: number;
	requestTimeoutMs: number;
	showExpiredSubscriptions: boolean;
} {
	const config = vscode.workspace.getConfiguration('rightcodeBar');
	const accounts = uniqAccountsByAlias(parseAccountsConfig(config.get<unknown>('accounts')));
	const activeAccount = (config.get<string>('activeAccount') ?? '').trim();
	const refreshIntervalSeconds = config.get<number>('refreshIntervalSeconds') ?? 300;
	const requestTimeoutMs = config.get<number>('requestTimeoutMs') ?? 15000;
	const showExpiredSubscriptions = config.get<boolean>('showExpiredSubscriptions') ?? false;
	return { accounts, activeAccount, refreshIntervalSeconds, requestTimeoutMs, showExpiredSubscriptions };
}

class DashboardViewProvider implements vscode.WebviewViewProvider {
	static readonly viewType = 'rightcodeBar.dashboard';
	private currentView: vscode.WebviewView | undefined;
	private refreshSubscriptionsInProgress = false;
	private refreshUsageStatsInProgress = false;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly output: vscode.OutputChannel,
		private readonly getAuth: () => Promise<RightCodeAuthContext>,
	) {}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.currentView = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, 'media'),
				vscode.Uri.joinPath(this.extensionUri, 'images'),
			],
		};

		webviewView.webview.html = this.getHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage((message) => {
			void this.handleWebviewMessage(message);
		});

		void this.postAccountInfo('rightcodeBar.dashboard.account');
	}

	private async handleWebviewMessage(message: unknown): Promise<void> {
		if (!isRecord(message)) {
			return;
		}

		const type = message.type;
		if (type === 'rightcodeBar.dashboard.requestAccount') {
			await this.postAccountInfo('rightcodeBar.dashboard.account');
			return;
		}

		if (type === 'rightcodeBar.dashboard.switchAccount') {
			await vscode.commands.executeCommand(COMMAND_ACCOUNT_SWITCH);
			return;
		}

		if (type === 'rightcodeBar.dashboard.requestSubscriptions') {
			await this.refreshSubscriptions();
			return;
		}

		if (type === 'rightcodeBar.dashboard.requestUsageStats') {
			const granularity = parseString(message.granularity);
			const startDate = parseString(message.startDate);
			const endDate = parseString(message.endDate);
			if (granularity !== 'day' && granularity !== 'hour') {
				return;
			}
			if (!startDate || !endDate) {
				return;
			}

			await this.refreshUsageStats({ granularity, startDate, endDate });
		}
	}

	async notifyAccountChanged(): Promise<void> {
		await this.postAccountInfo('rightcodeBar.dashboard.accountChanged');
	}

	private async postAccountInfo(type: 'rightcodeBar.dashboard.account' | 'rightcodeBar.dashboard.accountChanged'): Promise<void> {
		const view = this.currentView;
		if (!view) {
			return;
		}

		const auth = await this.getAuth();
		void view.webview.postMessage({
			type,
			label: auth.accountLabel,
			hasAuth: Boolean(auth.token),
		});
	}

	async refreshSubscriptions(): Promise<void> {
		const view = this.currentView;
		if (!view) {
			return;
		}

		if (this.refreshSubscriptionsInProgress) {
			return;
		}
		this.refreshSubscriptionsInProgress = true;

		try {
			const { requestTimeoutMs, showExpiredSubscriptions } = getConfig();
			const { token } = await this.getAuth();
			if (!token) {
				void view.webview.postMessage({
					type: 'rightcodeBar.dashboard.subscriptions',
					ok: false,
					error: '未配置认证信息：请使用命令 RightCode: Add Account，或在 VS Code 设置中填写 rightcodeBar.accounts。',
				});
				return;
			}

			const result = await fetchSubscriptionList({
				token,
				requestTimeoutMs,
				output: this.output,
			});

			const subscriptions = filterExpiredSubscriptions(result.subscriptions, { showExpiredSubscriptions });
			void view.webview.postMessage({
				type: 'rightcodeBar.dashboard.subscriptions',
				ok: true,
				refreshedAt: new Date().toISOString(),
				total: subscriptions.length,
				subscriptions,
			});
		} catch (error) {
			const messageText = error instanceof Error ? error.message : String(error);
			this.output.appendLine(`[error] dashboard subscriptions: ${messageText}`);
			void view.webview.postMessage({
				type: 'rightcodeBar.dashboard.subscriptions',
				ok: false,
				error: `${STATUS_TEXT_ERROR}（${messageText}）`,
			});
		} finally {
			this.refreshSubscriptionsInProgress = false;
		}
	}

	private async refreshUsageStats(params: {
		startDate: string;
		endDate: string;
		granularity: 'day' | 'hour';
	}): Promise<void> {
		const view = this.currentView;
		if (!view) {
			return;
		}

		if (this.refreshUsageStatsInProgress) {
			return;
		}
		this.refreshUsageStatsInProgress = true;

		try {
			const { requestTimeoutMs } = getConfig();
			const { token } = await this.getAuth();
			if (!token) {
				void view.webview.postMessage({
					type: 'rightcodeBar.dashboard.usageStats',
					ok: false,
					error: '未配置认证信息：请使用命令 RightCode: Add Account，或在 VS Code 设置中填写 rightcodeBar.accounts。',
				});
				return;
			}

			const result = await fetchUseLogAdvancedStats({
				token,
				startDate: params.startDate,
				endDate: params.endDate,
				granularity: params.granularity,
				requestTimeoutMs,
				output: this.output,
			});

			void view.webview.postMessage({
				type: 'rightcodeBar.dashboard.usageStats',
				ok: true,
				refreshedAt: new Date().toISOString(),
				startDate: params.startDate,
				endDate: params.endDate,
				granularity: params.granularity,
				stats: result,
			});
		} catch (error) {
			const messageText = error instanceof Error ? error.message : String(error);
			this.output.appendLine(`[error] dashboard usage stats: ${messageText}`);
			void view.webview.postMessage({
				type: 'rightcodeBar.dashboard.usageStats',
				ok: false,
				error: `${STATUS_TEXT_DASHBOARD_ERROR}（${messageText}）`,
			});
		} finally {
			this.refreshUsageStatsInProgress = false;
		}
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = getNonce();
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'dashboard.css'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'dashboard.js'));
		const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'images', 'rightcode-activitybar.png'));

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<link href="${styleUri}" rel="stylesheet" />
</head>
<body>
	<div class="rc-bg" aria-hidden="true"></div>
	<div class="page">
		<header class="header">
			<div class="header__row">
				<div class="brand">
					<img class="brand__logo" src="${logoUri}" alt="" />
					<div class="brand__text">
						<div class="brand__title">RightCode Dashboard</div>
					</div>
				</div>
				<div class="header__actions">
					<button class="btn btn--ghost" id="accountSwitchBtn" type="button">切换账号</button>
				</div>
			</div>
			<div class="header__meta">
				<div class="header__account" id="accountText">账号：-</div>
			</div>
		</header>

		<main class="content">
			<section class="top-grid">
				<section class="panel panel--subscription" aria-label="我的订阅">
					<div class="panel__header">
						<h2 class="panel__title">我的订阅</h2>
						<div class="panel__actions">
							<button class="btn btn--ghost" id="subsRefreshBtn" type="button">刷新</button>
						</div>
					</div>

					<div class="carousel" id="subscriptionCarousel">
						<button class="icon-btn" id="subsPrevBtn" type="button" aria-label="上一条订阅">
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
							</svg>
						</button>
						<div class="carousel__viewport" role="region" aria-label="订阅切换区域" tabindex="0">
							<div class="carousel__track" id="subsTrack"></div>
						</div>
						<button class="icon-btn" id="subsNextBtn" type="button" aria-label="下一条订阅">
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
							</svg>
						</button>
					</div>
					<div class="carousel__dots" id="subsDots" aria-hidden="true"></div>
					<div class="hint" id="subsHint"></div>
				</section>

				<section class="panel" aria-label="Token 使用情况">
					<div class="panel__header">
						<h2 class="panel__title">Token 使用情况</h2>
					</div>

					<div class="toolbar" role="group" aria-label="时间范围与刷新">
						<div class="toolbar__group" role="group" aria-label="聚合方式">
							<button class="pill is-active" type="button" data-granularity="day">按天</button>
							<button class="pill" type="button" data-granularity="hour">按小时</button>
						</div>
						<div class="toolbar__group" role="group" aria-label="快捷范围">
							<button class="pill pill--ghost" type="button" data-range="today" data-granularity="both">今日</button>
							<button class="pill pill--ghost is-active" type="button" data-range="7d" data-granularity="day">7天</button>
							<button class="pill pill--ghost" type="button" data-range="30d" data-granularity="day">30天</button>
							<button class="pill pill--ghost" type="button" data-range="yesterday" data-granularity="hour">昨天</button>
							<button class="pill pill--ghost" type="button" data-range="2d" data-granularity="hour">前天</button>
						</div>
						<div class="toolbar__spacer"></div>
						<button class="pill pill--accent" id="refreshBtn" type="button">刷新</button>
						<button class="toggle" id="autoRefreshToggle" type="button" role="switch" aria-checked="false">
							<span class="toggle__thumb" aria-hidden="true"></span>
							<span class="toggle__label">自动刷新 <span class="toggle__meta">60s</span></span>
						</button>
						<div class="date-range" aria-label="日期范围">
							<div class="date-range__label">日期范围</div>
							<div class="date-range__value" id="dateRangeText">-</div>
						</div>
					</div>

					<div class="stats-grid" aria-label="汇总指标">
						<div class="stat-card">
							<div class="stat-card__label">累计请求</div>
							<div class="stat-card__value" id="metricRequests">-</div>
						</div>
						<div class="stat-card">
							<div class="stat-card__label">累计 Token</div>
							<div class="stat-card__value" id="metricTokens">-</div>
						</div>
						<div class="stat-card">
							<div class="stat-card__label">累计花费</div>
							<div class="stat-card__value" id="metricCost">-</div>
						</div>
					</div>
				</section>
			</section>

			<section class="bottom-grid" aria-label="统计详情">
				<section class="panel" aria-label="Token 使用分布">
					<div class="panel__header">
						<h2 class="panel__title">Token 使用分布</h2>
					</div>
					<div class="distribution">
						<div class="donut" id="donut" aria-label="Token 使用分布图"></div>
						<div class="legend" id="legend" aria-label="模型占比图例"></div>
					</div>
				</section>

				<section class="panel" aria-label="详细统计数据">
					<div class="panel__header">
						<h2 class="panel__title">详细统计数据</h2>
					</div>
					<div class="table-wrap">
						<table class="table" aria-label="模型统计表">
							<thead>
								<tr>
									<th>模型</th>
									<th class="num">请求数</th>
									<th class="num">总 Token</th>
									<th class="num">费用</th>
									<th class="num">占比</th>
								</tr>
							</thead>
							<tbody id="detailsTableBody"></tbody>
						</table>
					</div>
				</section>
			</section>

			<div class="footer">
				<div id="lastUpdatedText">最后刷新：-</div>
			</div>
		</main>
	</div>

	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let index = 0; index < 32; index++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

async function migrateLegacyTokenToAccountsIfNeeded(params: { output: vscode.OutputChannel }): Promise<void> {
	const config = vscode.workspace.getConfiguration('rightcodeBar');
	const tokenFromSettings = (config.get<string>('token') ?? '').trim();
	const normalizedToken = normalizeTokenInput(tokenFromSettings);
	if (!normalizedToken) {
		return;
	}

	const accounts = uniqAccountsByAlias(parseAccountsConfig(config.get<unknown>('accounts')));
	const activeAccount = (config.get<string>('activeAccount') ?? '').trim();

	const alreadyInAccounts = accounts.some((account) => account.token === normalizedToken);
	if (!alreadyInAccounts) {
		let alias = DEFAULT_ACCOUNT_ALIAS;
		if (accounts.some((account) => account.alias === alias)) {
			let suffix = 2;
			while (accounts.some((account) => account.alias === `${DEFAULT_ACCOUNT_ALIAS}-${suffix}`)) {
				suffix += 1;
			}
			alias = `${DEFAULT_ACCOUNT_ALIAS}-${suffix}`;
		}
		const merged = [...accounts, { alias, token: normalizedToken }];
		await config.update('accounts', merged, vscode.ConfigurationTarget.Global);
		if (!activeAccount && accounts.length === 0) {
			await config.update('activeAccount', alias, vscode.ConfigurationTarget.Global);
		}
		params.output.appendLine(`[info] Migrated legacy rightcodeBar.token into rightcodeBar.accounts as "${alias}".`);
	}

	try {
		await config.update('token', undefined, vscode.ConfigurationTarget.Global);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		params.output.appendLine(`[warn] Failed to remove legacy rightcodeBar.token: ${message}`);
	}
}

async function runAddAccountFlow(params: { output: vscode.OutputChannel }): Promise<void> {
	type MethodPickItem = vscode.QuickPickItem & { method: 'password' | 'manualToken' };

	const picked = await vscode.window.showQuickPick<MethodPickItem>(
		[
			{
				label: '\u90ae\u7bb1/\u7528\u6237\u540d + \u5bc6\u7801\u767b\u5f55',
				description: '\u81ea\u52a8\u83b7\u53d6 token\uff0c\u9002\u7528\u4e8e\u975e linux.do OAuth2 \u8d26\u53f7',
				method: 'password',
			},
			{
				label: 'linux.do OAuth2 (\u624b\u52a8 token)',
				description: '\u8bf7\u81ea\u884c\u83b7\u53d6 token\uff0c\u7136\u540e\u586b\u5165 rightcodeBar.accounts',
				method: 'manualToken',
			},
		],
		{
			title: '\u6dfb\u52a0 RightCode \u8d26\u53f7',
			placeHolder: '\u9009\u62e9\u767b\u5f55\u65b9\u5f0f',
			ignoreFocusOut: true,
		},
	);
	if (!picked) {
		return;
	}

	if (picked.method === 'manualToken') {
		await vscode.commands.executeCommand(COMMAND_OPEN_SETTINGS);
		return;
	}

	const loginUsername = await vscode.window.showInputBox({
		title: '\u767b\u5f55 RightCode',
		prompt: '\u8bf7\u8f93\u5165\u90ae\u7bb1\u6216\u7528\u6237\u540d',
		ignoreFocusOut: true,
		validateInput: (value) => (value.trim() ? undefined : '\u4e0d\u80fd\u4e3a\u7a7a'),
	});
	if (!loginUsername) {
		return;
	}

	const loginPassword = await vscode.window.showInputBox({
		title: '\u767b\u5f55 RightCode',
		prompt: '\u8bf7\u8f93\u5165\u5bc6\u7801',
		password: true,
		ignoreFocusOut: true,
		validateInput: (value) => (value ? undefined : '\u4e0d\u80fd\u4e3a\u7a7a'),
	});
	if (!loginPassword) {
		return;
	}

	const { requestTimeoutMs } = getConfig();
	let loginResult: RightCodeLoginResult;
	try {
		loginResult = await fetchLoginByPassword({
			username: loginUsername.trim(),
			password: loginPassword,
			requestTimeoutMs,
			output: params.output,
		});
	} catch (error) {
		if (isRightCodeLoginError(error)) {
			if (error.code === 'INVALID_CREDENTIALS') {
				vscode.window.showErrorMessage('\u7528\u6237\u540d\u6216\u8005\u5bc6\u7801\u9519\u8bef');
				return;
			}
			if (error.code === 'FORBIDDEN') {
				vscode.window.showErrorMessage(
					'\u767b\u5f55\u88ab\u62d2\u7edd\uff08\u53ef\u80fd\u9700\u8981\u6d4f\u89c8\u5668\u9a8c\u8bc1\uff09\uff0c\u8bf7\u6539\u7528\u624b\u52a8 token \u6dfb\u52a0\u3002',
				);
				return;
			}
		}

		const message = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage(`\u767b\u5f55\u5931\u8d25\uff1a${message}`);
		return;
	}

	const suggestedAlias = (loginResult.username ?? loginUsername).trim();
	const normalizedToken = normalizeTokenInput(loginResult.userToken);

	const config = vscode.workspace.getConfiguration('rightcodeBar');
	let accounts = uniqAccountsByAlias(parseAccountsConfig(config.get<unknown>('accounts')));

	while (true) {
		const aliasRaw = await vscode.window.showInputBox({
			title: '\u8d26\u53f7\u522b\u540d',
			prompt: '\u7528\u4e8e\u72b6\u6001\u680f/\u9762\u677f\u663e\u793a',
			value: suggestedAlias,
			ignoreFocusOut: true,
			validateInput: (value) => (value.trim() ? undefined : '\u4e0d\u80fd\u4e3a\u7a7a'),
		});
		if (!aliasRaw) {
			return;
		}

		const alias = aliasRaw.trim();
		const existingIndex = accounts.findIndex((account) => account.alias === alias);
		if (existingIndex === -1) {
			accounts = [...accounts, { alias, token: normalizedToken }];
			await config.update('accounts', accounts, vscode.ConfigurationTarget.Global);
			await config.update('activeAccount', alias, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`\u5df2\u6dfb\u52a0 RightCode \u8d26\u53f7\uff1a${alias}`);
			return;
		}

		const overwrite = '\u8986\u76d6';
		const reenter = '\u91cd\u65b0\u8f93\u5165\u522b\u540d';
		const choice = await vscode.window.showWarningMessage(
			`\u8d26\u53f7\u522b\u540d \"${alias}\" \u5df2\u5b58\u5728\uff0c\u662f\u5426\u8986\u76d6\uff1f`,
			{ modal: true },
			overwrite,
			reenter,
		);
		if (choice === overwrite) {
			accounts = accounts.map((account, index) =>
				index === existingIndex ? { alias, token: normalizedToken } : account,
			);
			await config.update('accounts', accounts, vscode.ConfigurationTarget.Global);
			await config.update('activeAccount', alias, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`\u5df2\u66f4\u65b0 RightCode \u8d26\u53f7\uff1a${alias}`);
			return;
		}
		if (choice === reenter) {
			continue;
		}
		return;
	}
}

function createAuthManager(params: {
	output: vscode.OutputChannel;
}): {
	listAccounts: () => { accounts: RightCodeAccountConfig[]; activeAccount: string };
	setActiveAccount: (alias: string) => Promise<void>;
	getAuth: () => Promise<RightCodeAuthContext>;
} {
	let warnedInvalidActiveAccount = false;

	const listAccounts = (): { accounts: RightCodeAccountConfig[]; activeAccount: string } => {
		const { accounts, activeAccount } = getConfig();
		return { accounts, activeAccount };
	};

	const setActiveAccount = async (alias: string): Promise<void> => {
		const config = vscode.workspace.getConfiguration('rightcodeBar');
		await config.update('activeAccount', alias, vscode.ConfigurationTarget.Global);
	};

	const getAuth = async (): Promise<RightCodeAuthContext> => {
		const { accounts, activeAccount } = getConfig();
		if (accounts.length > 0) {
			const resolved =
				(activeAccount ? accounts.find((account) => account.alias === activeAccount) : undefined) ?? accounts[0]!;
			if (activeAccount && resolved.alias !== activeAccount && !warnedInvalidActiveAccount) {
				params.output.appendLine(
					`[warn] rightcodeBar.activeAccount "${activeAccount}" not found. Using "${resolved.alias}".`,
				);
				warnedInvalidActiveAccount = true;
			}

			return {
				token: resolved.token,
				accountLabel: resolved.alias,
				accountAlias: resolved.alias,
			};
		}

		return {
			token: '',
			accountLabel: '未配置',
		};
	};

	return { listAccounts, setActiveAccount, getAuth };
}

export async function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('RightCode Bar');
	context.subscriptions.push(output);

	await migrateLegacyTokenToAccountsIfNeeded({ output });

	const authManager = createAuthManager({ output });
	const getAuth = authManager.getAuth;

	const dashboardProvider = new DashboardViewProvider(context.extensionUri, output, getAuth);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			DashboardViewProvider.viewType,
			dashboardProvider,
		),
	);

	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.name = 'RightCode Subscription';
	statusBarItem.command = COMMAND_REFRESH;
	statusBarItem.text = '加载中...';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	let refreshTimer: NodeJS.Timeout | undefined;
	let refreshInProgress = false;

	const refresh = async (): Promise<void> => {
		if (refreshInProgress) {
			return;
		}
		refreshInProgress = true;

		const refreshedAt = new Date();
		try {
			const { requestTimeoutMs, showExpiredSubscriptions } = getConfig();
			const { token, accountLabel } = await getAuth();
			if (!token) {
				statusBarItem.text = STATUS_TEXT_ERROR;
				statusBarItem.tooltip = buildMissingConfigTooltip();
				return;
			}

			const result = await fetchSubscriptionList({ token, requestTimeoutMs, output });
			const subscriptions = filterExpiredSubscriptions(result.subscriptions, { showExpiredSubscriptions });
			if (subscriptions.length === 0) {
				statusBarItem.text = '当前暂无订阅';
				statusBarItem.tooltip = buildNoSubscriptionTooltip(refreshedAt);
				return;
			}

			const selected = pickDisplaySubscription(subscriptions);
			if (!selected) {
				statusBarItem.text = '当前暂无订阅';
				statusBarItem.tooltip = buildNoSubscriptionTooltip(refreshedAt);
				return;
			}

			statusBarItem.text = `${accountLabel} · ${selected.name} 剩余 $${formatQuota(selected.remainingQuota)}`;
			statusBarItem.tooltip = buildSuccessTooltip({
				accountLabel,
				selected,
				all: subscriptions,
				refreshedAt,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			statusBarItem.text = STATUS_TEXT_ERROR;
			statusBarItem.tooltip = buildErrorTooltip(message);
			output.appendLine(`[error] ${message}`);
		} finally {
			refreshInProgress = false;
		}
	};

	const updateTimer = (): void => {
		if (refreshTimer) {
			clearInterval(refreshTimer);
			refreshTimer = undefined;
		}

		const { refreshIntervalSeconds } = getConfig();
		if (refreshIntervalSeconds > 0) {
			refreshTimer = setInterval(() => void refresh(), refreshIntervalSeconds * 1000);
		}
	};

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND_REFRESH, async () => {
			await refresh();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND_ACCOUNT_ADD, async () => {
			await runAddAccountFlow({ output });
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND_ACCOUNT_SWITCH, async () => {
			const { accounts, activeAccount } = authManager.listAccounts();
			if (accounts.length === 0) {
				const choice = await vscode.window.showInformationMessage(
					'尚未配置 RightCode 账号：请使用 RightCode: Add Account 登录，或在设置中填写 rightcodeBar.accounts。',
					'添加账号',
					'打开设置',
				);
				if (choice === '添加账号') {
					await vscode.commands.executeCommand(COMMAND_ACCOUNT_ADD);
					return;
				}
				if (choice === '打开设置') {
					await vscode.commands.executeCommand(COMMAND_OPEN_SETTINGS);
				}
				return;
			}

			const resolvedActive =
				(activeAccount ? accounts.find((account) => account.alias === activeAccount) : undefined) ?? accounts[0]!;

			type AccountPickItem = vscode.QuickPickItem & { alias: string };
			const items: AccountPickItem[] = [...accounts]
				.sort((a, b) => a.alias.localeCompare(b.alias, 'zh-CN'))
				.map((account) => ({
					label: account.alias,
					description: account.alias === resolvedActive.alias ? '当前' : undefined,
					alias: account.alias,
				}));

			const picked = await vscode.window.showQuickPick(items, {
				title: '切换 RightCode 账号',
				placeHolder: '选择一个账号',
				ignoreFocusOut: true,
			});
			if (!picked) {
				return;
			}

			await authManager.setActiveAccount(picked.alias);
			vscode.window.showInformationMessage(`已切换 RightCode 账号：${picked.label}`);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND_OPEN_SETTINGS, async () => {
			await vscode.commands.executeCommand('workbench.action.openSettings', 'rightcodeBar');
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('rightcodeBar')) {
				if (event.affectsConfiguration('rightcodeBar.accounts') || event.affectsConfiguration('rightcodeBar.activeAccount')) {
					void dashboardProvider.notifyAccountChanged();
				}
				if (event.affectsConfiguration('rightcodeBar.showExpiredSubscriptions')) {
					void dashboardProvider.refreshSubscriptions();
				}
				updateTimer();
				void refresh();
			}
		}),
	);

	updateTimer();
	void refresh();
}

export function deactivate() {}
