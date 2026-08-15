import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { VetroBridge } from '../common/VetroBridge';

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  private bridge: VetroBridge = new VetroBridge(getContext(this) as common.UIAbilityContext);

  build() {
    Column() {
      Web({ src: $rawfile('www/index.html'), controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .fileAccess(true)
        .onlineImageAccess(true)
        .onPageEnd(() => {
          // 页面加载完成后注册原生桥，再刷新一次让 H5 拿到 window.vetroNative
          try {
            this.controller.registerJavaScriptProxy({
              object: this.bridge,
              name: 'vetroNative',
              methodList: [
                'dbInit', 'dbSave', 'dbLoad', 'dbSearch',
                'secureSet', 'secureGet', 'secureDelete',
                'httpRequest', 'saveFile', 'writeFile', 'readFile', 'openFile'
              ]
            });
            this.controller.refresh();
          } catch (e) {
            console.error('registerJavaScriptProxy failed: ' + JSON.stringify(e));
          }
        })
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
  }
}
