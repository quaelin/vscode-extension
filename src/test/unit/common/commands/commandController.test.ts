import sinon from 'sinon';
import * as util from 'util';
import { IAuthenticationService } from '../../../../snyk/base/services/authenticationService';
import { ScanModeService } from '../../../../snyk/base/services/scanModeService';
import { IAnalytics } from '../../../../snyk/common/analytics/itly';
import { CommandController } from '../../../../snyk/common/commands/commandController';
import { COMMAND_DEBOUNCE_INTERVAL } from '../../../../snyk/common/constants/general';
import { CodeIssueData, IacIssueData } from '../../../../snyk/common/languageServer/types';
import { IOpenerService } from '../../../../snyk/common/services/openerService';
import { IProductService } from '../../../../snyk/common/services/productService';
import { IVSCodeCommands } from '../../../../snyk/common/vscode/commands';
import { IVSCodeWorkspace } from '../../../../snyk/common/vscode/workspace';
import { OssService } from '../../../../snyk/snykOss/ossService';
import { LanguageServerMock } from '../../mocks/languageServer.mock';
import { LoggerMock } from '../../mocks/logger.mock';
import { windowMock } from '../../mocks/window.mock';

suite('CommandController', () => {
  const sleep = util.promisify(setTimeout);

  let controller: CommandController;

  setup(() => {
    controller = new CommandController(
      {} as IOpenerService,
      {} as IAuthenticationService,
      {} as IProductService<CodeIssueData>,
      {} as IProductService<IacIssueData>,
      {} as OssService,
      {} as ScanModeService,
      {} as IVSCodeWorkspace,
      {} as IVSCodeCommands,
      windowMock,
      new LanguageServerMock(),
      new LoggerMock(),
      {} as IAnalytics,
    );
  });

  test('Executes debounced command when larger than debounce pause', async () => {
    // Arrange
    const fakeFunc = sinon.fake();
    const args = ['test', 0, true];

    // Act
    await controller.executeCommand('snyk.test', fakeFunc, args);
    await controller.executeCommand('snyk.test', fakeFunc, args);

    // Assert
    sinon.assert.calledOnceWithExactly(fakeFunc, args);
  });

  test("Doesn't execute debounced command within the debounce interval", async () => {
    // Arrange
    const fakeFunc = sinon.fake();
    const args = ['test', 0, true];

    // Act
    await controller.executeCommand('snyk.test', fakeFunc, args);
    await sleep(COMMAND_DEBOUNCE_INTERVAL + 1);
    await controller.executeCommand('snyk.test', fakeFunc, args);

    // Assert
    sinon.assert.calledTwice(fakeFunc);
    sinon.assert.calledWith(fakeFunc, args);
  });
});
