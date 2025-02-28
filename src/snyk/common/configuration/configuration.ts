import _ from 'lodash';
import path from 'path';
import { URL } from 'url';
import { IDE_NAME_SHORT, SNYK_TOKEN_KEY } from '../constants/general';
import {
  ADVANCED_ADDITIONAL_PARAMETERS_SETTING,
  ADVANCED_ADVANCED_MODE_SETTING,
  ADVANCED_AUTOMATIC_DEPENDENCY_MANAGEMENT,
  ADVANCED_AUTOSCAN_OSS_SETTING,
  ADVANCED_CLI_PATH,
  ADVANCED_CUSTOM_ENDPOINT,
  ADVANCED_CUSTOM_LS_PATH,
  ADVANCED_ORGANIZATION,
  CODE_QUALITY_ENABLED_SETTING,
  CODE_SECURITY_ENABLED_SETTING,
  CONFIGURATION_IDENTIFIER,
  FEATURES_PREVIEW_SETTING,
  IAC_ENABLED_SETTING,
  OSS_ENABLED_SETTING,
  SCANNING_MODE,
  SEVERITY_FILTER_SETTING,
  TRUSTED_FOLDERS,
  YES_BACKGROUND_OSS_NOTIFICATION_SETTING,
  YES_CRASH_REPORT_SETTING,
  YES_TELEMETRY_SETTING,
  YES_WELCOME_NOTIFICATION_SETTING,
} from '../constants/settings';
import SecretStorageAdapter from '../vscode/secretStorage';
import { IVSCodeWorkspace } from '../vscode/workspace';

export type FeaturesConfiguration = {
  ossEnabled: boolean | undefined;
  codeSecurityEnabled: boolean | undefined;
  codeQualityEnabled: boolean | undefined;
  iacEnabled: boolean | undefined;
};

export interface SeverityFilter {
  critical: boolean;
  high: boolean;
  medium: boolean;
  low: boolean;

  [severity: string]: boolean;
}

export type PreviewFeatures = {
  advisor: boolean | undefined;
};

export interface IConfiguration {
  shouldShowAdvancedView: boolean;
  isDevelopment: boolean;
  source: string;

  authHost: string;
  baseApiUrl: string;

  getToken(): Promise<string | undefined>;

  setToken(token: string | undefined): Promise<void>;

  setCliPath(cliPath: string): Promise<void>;

  clearToken(): Promise<void>;

  snykCodeToken: Promise<string | undefined>;
  snykCodeBaseURL: string;
  snykCodeUrl: string;

  organization: string | undefined;

  getAdditionalCliParameters(): string | undefined;

  snykOssApiEndpoint: string;
  shouldShowOssBackgroundScanNotification: boolean;

  hideOssBackgroundScanNotification(): Promise<void>;

  shouldAutoScanOss: boolean;

  shouldReportErrors: boolean;
  shouldReportEvents: boolean;
  shouldShowWelcomeNotification: boolean;

  hideWelcomeNotification(): Promise<void>;

  getFeaturesConfiguration(): FeaturesConfiguration;

  setFeaturesConfiguration(config: FeaturesConfiguration | undefined): Promise<void>;

  getPreviewFeatures(): PreviewFeatures;

  isAutomaticDependencyManagementEnabled(): boolean;

  getCliPath(): string | undefined;

  getInsecure(): boolean;

  isFedramp: boolean;

  analyticsPermitted: boolean;

  severityFilter: SeverityFilter;

  scanningMode: string | undefined;

  getSnykLanguageServerPath(): string | undefined;

  setShouldReportEvents(b: boolean): Promise<void>;

  getTrustedFolders(): string[];

  setTrustedFolders(trustedFolders: string[]): Promise<void>;

  setEndpoint(endpoint: string): Promise<void>;
}

export class Configuration implements IConfiguration {
  // These attributes are used in tests
  private readonly defaultSnykCodeBaseURL = 'https://deeproxy.snyk.io';
  private readonly defaultAuthHost = 'https://snyk.io';
  private readonly defaultOssApiEndpoint = `${this.defaultAuthHost}/api/v1`;
  private readonly defaultBaseApiHost = 'https://api.snyk.io';
  private readonly analyticsPermittedEnvironments = { 'app.snyk.io': true, 'app.us.snyk.io': true };

  constructor(private processEnv: NodeJS.ProcessEnv = process.env, private workspace: IVSCodeWorkspace) {}

  getInsecure(): boolean {
    const strictSSL = this.workspace.getConfiguration<boolean>('http', 'proxyStrictSSL') ?? true;
    return !strictSSL;
  }

  static async getVersion(): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { version } = await this.getPackageJsonConfig();
    return version;
  }

  static async isPreview(): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { preview } = await this.getPackageJsonConfig();
    return preview;
  }

  private static async getPackageJsonConfig(): Promise<{ version: string; preview: boolean }> {
    return (await import(path.join('../../../..', 'package.json'))) as { version: string; preview: boolean };
  }

  get isDevelopment(): boolean {
    return !!this.processEnv.SNYK_VSCE_DEVELOPMENT;
  }

  get snykCodeBaseURL(): string {
    if (this.processEnv.SNYK_VSCE_DEVELOPMENT_SNYKCODE_BASE_URL) {
      return this.processEnv.SNYK_VSCE_DEVELOPMENT_SNYKCODE_BASE_URL;
    } else if (this.customEndpoint) {
      const url = new URL(this.customEndpoint);

      if (Configuration.isSingleTenant(url)) {
        url.host = url.host.replace('app', 'deeproxy');
      } else {
        url.host = `deeproxy.${url.host}`;
      }
      url.pathname = url.pathname.replace('api', '');

      return this.removeTrailingSlash(url.toString());
    }

    return this.defaultSnykCodeBaseURL;
  }

  private get customEndpoint(): string | undefined {
    return this.workspace.getConfiguration<string>(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(ADVANCED_CUSTOM_ENDPOINT),
    );
  }

  get authHost(): string {
    if (this.customEndpoint) {
      const url = new URL(this.customEndpoint);
      return `${url.protocol}//${url.host}`;
    }

    return this.defaultAuthHost;
  }

  async setEndpoint(endpoint: string): Promise<void> {
    await this.workspace.updateConfiguration(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(ADVANCED_CUSTOM_ENDPOINT),
      endpoint.toString(),
      true,
    );
  }

  get isFedramp(): boolean {
    if (!this.customEndpoint) return false;

    // FEDRAMP URL e.g. https://api.feddramp.snykgov.io
    const endpoint = new URL(this.customEndpoint);

    // hostname validation
    const hostnameParts = endpoint.hostname.split('.');
    if (hostnameParts.length < 3) return false;

    const isFedrampDomain = `${hostnameParts[2]}.${hostnameParts[3]}`.includes('snykgov.io');
    return isFedrampDomain;
  }

  get analyticsPermitted(): boolean {
    if (!this.customEndpoint) return true;

    const hostname = new URL(this.customEndpoint).hostname;
    return hostname in this.analyticsPermittedEnvironments;
  }

  get snykOssApiEndpoint(): string {
    if (this.customEndpoint) {
      return this.customEndpoint; // E.g. https://app.eu.snyk.io/api
    }

    return this.defaultOssApiEndpoint;
  }

  get snykCodeUrl(): string {
    const authUrl = new URL(this.authHost);

    if (Configuration.isSingleTenant(authUrl)) {
      authUrl.pathname = authUrl.pathname.replace('api', '');
    } else {
      authUrl.host = `app.${authUrl.host}`;
    }

    return `${authUrl.toString()}manage/snyk-code?from=vscode`;
  }

  getSnykLanguageServerPath(): string | undefined {
    return this.workspace.getConfiguration<string>(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(ADVANCED_CUSTOM_LS_PATH),
    );
  }

  async getToken(): Promise<string | undefined> {
    return new Promise(resolve => {
      SecretStorageAdapter.instance
        .get(SNYK_TOKEN_KEY)
        .then(token => resolve(token))
        .catch(async _ => {
          // clear the token and return empty string
          await this.clearToken();
          resolve('');
        });
    });
  }

  get snykCodeToken(): Promise<string | undefined> {
    if (this.isDevelopment && this.processEnv.SNYK_VSCE_DEVELOPMENT_SNYKCODE_TOKEN) {
      return Promise.resolve(this.processEnv.SNYK_VSCE_DEVELOPMENT_SNYKCODE_TOKEN);
    }
    return this.getToken();
  }

  async setToken(token: string | undefined): Promise<void> {
    if (!token) return;
    return await SecretStorageAdapter.instance.store(SNYK_TOKEN_KEY, token);
  }

  async setCliPath(cliPath: string | undefined): Promise<void> {
    if (!cliPath) return;
    return this.workspace.updateConfiguration(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(ADVANCED_CLI_PATH),
      cliPath,
      true,
    );
  }

  async clearToken(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      SecretStorageAdapter.instance
        .delete(SNYK_TOKEN_KEY)
        .then(() => resolve())
        .catch(error => {
          reject(error);
        });
    });
  }

  static get source(): string {
    return IDE_NAME_SHORT;
  }

  get source(): string {
    return Configuration.source;
  }

  get baseApiUrl(): string {
    return this.defaultBaseApiHost;
  }

  getFeaturesConfiguration(): FeaturesConfiguration {
    const ossEnabled = this.workspace.getConfiguration<boolean>(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(OSS_ENABLED_SETTING),
    );
    const codeSecurityEnabled = this.workspace.getConfiguration<boolean>(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(CODE_SECURITY_ENABLED_SETTING),
    );
    const codeQualityEnabled = this.workspace.getConfiguration<boolean>(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(CODE_QUALITY_ENABLED_SETTING),
    );
    const iacEnabled = this.workspace.getConfiguration<boolean>(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(IAC_ENABLED_SETTING),
    );

    if (
      _.isUndefined(ossEnabled) &&
      _.isUndefined(codeSecurityEnabled) &&
      _.isUndefined(codeQualityEnabled) &&
      _.isUndefined(iacEnabled)
    ) {
      // TODO: return 'undefined' to render feature selection screen once OSS integration is available
      return { ossEnabled: true, codeSecurityEnabled: true, codeQualityEnabled: true, iacEnabled: true };
    }

    return {
      ossEnabled,
      codeSecurityEnabled,
      codeQualityEnabled,
      iacEnabled,
    };
  }

  async setFeaturesConfiguration(config: FeaturesConfiguration | undefined): Promise<void> {
    await this.workspace.updateConfiguration(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(CODE_SECURITY_ENABLED_SETTING),
      config?.codeSecurityEnabled,
      true,
    );
    await this.workspace.updateConfiguration(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(CODE_QUALITY_ENABLED_SETTING),
      config?.codeQualityEnabled,
      true,
    );
  }

  get shouldReportErrors(): boolean {
    return !!this.workspace.getConfiguration<boolean>(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(YES_CRASH_REPORT_SETTING),
    );
  }

  get shouldReportEvents(): boolean {
    return !!this.workspace.getConfiguration<boolean>(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(YES_TELEMETRY_SETTING),
    );
  }

  async setShouldReportEvents(yesTelemetry: boolean): Promise<void> {
    await this.workspace.updateConfiguration(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(YES_TELEMETRY_SETTING),
      yesTelemetry,
      true,
    );
  }

  get shouldShowWelcomeNotification(): boolean {
    return !!this.workspace.getConfiguration<boolean>(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(YES_WELCOME_NOTIFICATION_SETTING),
    );
  }

  async hideWelcomeNotification(): Promise<void> {
    await this.workspace.updateConfiguration(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(YES_WELCOME_NOTIFICATION_SETTING),
      false,
      true,
    );
  }

  get shouldShowOssBackgroundScanNotification(): boolean {
    return !!this.workspace.getConfiguration<boolean>(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(YES_BACKGROUND_OSS_NOTIFICATION_SETTING),
    );
  }

  async hideOssBackgroundScanNotification(): Promise<void> {
    await this.workspace.updateConfiguration(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(YES_BACKGROUND_OSS_NOTIFICATION_SETTING),
      false,
      true,
    );
  }

  get shouldShowAdvancedView(): boolean {
    return !!this.workspace.getConfiguration<boolean>(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(ADVANCED_ADVANCED_MODE_SETTING),
    );
  }

  get shouldAutoScanOss(): boolean {
    return !!this.workspace.getConfiguration<boolean>(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(ADVANCED_AUTOSCAN_OSS_SETTING),
    );
  }

  get severityFilter(): SeverityFilter {
    const config = this.workspace.getConfiguration<SeverityFilter>(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(SEVERITY_FILTER_SETTING),
    );

    return (
      config ?? {
        critical: true,
        high: true,
        medium: true,
        low: true,
      }
    );
  }

  get organization(): string | undefined {
    return this.workspace.getConfiguration<string>(CONFIGURATION_IDENTIFIER, this.getConfigName(ADVANCED_ORGANIZATION));
  }

  getPreviewFeatures(): PreviewFeatures {
    const defaultSetting: PreviewFeatures = {
      advisor: false,
    };

    const userSetting =
      this.workspace.getConfiguration<PreviewFeatures>(
        CONFIGURATION_IDENTIFIER,
        this.getConfigName(FEATURES_PREVIEW_SETTING),
      ) || {};

    return {
      ...defaultSetting,
      ...userSetting,
    };
  }

  getAdditionalCliParameters(): string | undefined {
    return this.workspace.getConfiguration<string>(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(ADVANCED_ADDITIONAL_PARAMETERS_SETTING),
    );
  }

  isAutomaticDependencyManagementEnabled(): boolean {
    return !!this.workspace.getConfiguration<boolean>(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(ADVANCED_AUTOMATIC_DEPENDENCY_MANAGEMENT),
    );
  }

  getCliPath(): string | undefined {
    return this.workspace.getConfiguration<string>(CONFIGURATION_IDENTIFIER, this.getConfigName(ADVANCED_CLI_PATH));
  }

  getTrustedFolders(): string[] {
    return (
      this.workspace.getConfiguration<string[]>(CONFIGURATION_IDENTIFIER, this.getConfigName(TRUSTED_FOLDERS)) || []
    );
  }

  get scanningMode(): string | undefined {
    return this.workspace.getConfiguration<string>(CONFIGURATION_IDENTIFIER, this.getConfigName(SCANNING_MODE));
  }

  async setTrustedFolders(trustedFolders: string[]): Promise<void> {
    await this.workspace.updateConfiguration(
      CONFIGURATION_IDENTIFIER,
      this.getConfigName(TRUSTED_FOLDERS),
      trustedFolders,
      true,
    );
  }
  private getConfigName = (setting: string) => setting.replace(`${CONFIGURATION_IDENTIFIER}.`, '');

  private static isSingleTenant(url: URL): boolean {
    return url.host.startsWith('app') && url.host.endsWith('snyk.io');
  }

  private removeTrailingSlash(str: string) {
    return str.replace(/\/$/, '');
  }
}
