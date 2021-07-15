import React, { Component, createRef } from "react";
import { Platform } from "react-native";
import WebView, {
  WebViewMessageEvent,
  WebViewProps,
} from "react-native-webview";
import RNFS from "react-native-fs";
import { Buffer } from "buffer";
import Package from "./package.json";

import "./index.html";

const InjectScriptName = {
  SetHTML: "setHTML",
  SetPreviewMode: "setPreviewMode",
} as const;

const EventName = {
  IsMounted: "isMounted",
  OnLoad: "onLoad",
  HeightChange: "heightChange",
  ClickLink: "clickLink",
  Debugger: "debugger",
} as const;

const messageBodyFileTargetPath = `file://${RNFS.CachesDirectoryPath}/messageBody.html`;
let messageBodyFilePath = messageBodyFileTargetPath;

async function copyFileForIos() {
  const htmlPath = `file://${RNFS.MainBundlePath}/assets/node_modules/${Package.name}/index.html`;
  try {
    const fileHasExists = await RNFS.exists(messageBodyFileTargetPath);
    if (fileHasExists) {
      await RNFS.unlink(messageBodyFileTargetPath);
    }
    await RNFS.copyFile(htmlPath, messageBodyFileTargetPath);
    return messageBodyFileTargetPath;
  } catch (err) {
    // badcase remedy
    return htmlPath;
  }
}

async function copyFileForAndroid() {
  const htmlResPath = `raw/node_modules_${Package.name.replace(
    /-/g,
    ""
  )}_index.html`;
  try {
    const fileHasExists = await RNFS.exists(messageBodyFileTargetPath);
    if (fileHasExists) {
      await RNFS.unlink(messageBodyFileTargetPath);
    }
    await RNFS.copyFileRes(htmlResPath, messageBodyFileTargetPath);
    return messageBodyFileTargetPath;
  } catch (err) {
    // badcase remedy
    return `file:///android_res/${htmlResPath}`;
  }
}

async function copyFile() {
  if (Platform.OS === "ios") {
    const filePath = await copyFileForIos();
    messageBodyFilePath = filePath;
  } else if (Platform.OS === "android") {
    const filePath = await copyFileForAndroid();
    messageBodyFilePath = filePath;
  }
}

copyFile();

export type WebviewEvent = Exclude<
  typeof EventName[keyof typeof EventName],
  typeof EventName["IsMounted"]
>;

type WithoutProps =
  | "ref"
  | "originWhitelist"
  | "source"
  | "allowingReadAccessToURL"
  | "onMessage";
type EdisonWebViewProps = {
  html: string;
  isDrakMode?: boolean;
  isPreviewMode?: boolean;
  onMessage: (type: WebviewEvent, data: any) => void;
} & Omit<WebViewProps, WithoutProps>;

type EdisonWebViewState = {
  webviewUri: string;
};
export default class RNWebView extends Component<
  EdisonWebViewProps,
  EdisonWebViewState
> {
  timeoutMap: Map<string, NodeJS.Timeout> = new Map();
  webviewMounted: boolean = false;
  constructor(props: any) {
    super(props);
    this.state = {
      webviewUri: "",
    };
  }

  private webViewRef = createRef<WebView>();

  componentDidMount() {
    this.setState({ webviewUri: messageBodyFilePath });
  }

  componentDidUpdate(prevProps: EdisonWebViewProps) {
    if (
      prevProps.isDrakMode !== this.props.isDrakMode ||
      prevProps.html !== this.props.html
    ) {
      this.initHtml();
    }
    if (prevProps.isPreviewMode !== this.props.isPreviewMode) {
      this.executeScript(
        InjectScriptName.SetPreviewMode,
        String(!!this.props.isPreviewMode)
      );
    }
  }

  private executeScript = (
    functionName: typeof InjectScriptName[keyof typeof InjectScriptName],
    parameter?: string
  ) => {
    if (!this.webViewRef.current) {
      return;
    }
    const timeout = this.timeoutMap.get(functionName);
    if (timeout) {
      clearTimeout(timeout);
    }
    if (!this.webviewMounted) {
      this.timeoutMap.set(
        functionName,
        setTimeout(() => {
          this.executeScript(functionName, parameter);
        }, 100)
      );
      return;
    }
    this.webViewRef.current.injectJavaScript(
      `window.${functionName} && window.${functionName}(${
        parameter ? `'${parameter}'` : ""
      });true;`
    );
  };

  private onMessage = (event: WebViewMessageEvent) => {
    try {
      const messageData: {
        type: typeof EventName[keyof typeof EventName];
        data: any;
      } = JSON.parse(event.nativeEvent.data);
      if (messageData.type === EventName.IsMounted) {
        this.webviewMounted = true;
        this.initHtml();
        this.executeScript(
          InjectScriptName.SetPreviewMode,
          String(!!this.props.isPreviewMode)
        );
      } else if (this.props.onMessage) {
        this.props.onMessage(messageData.type, messageData.data);
      }
    } catch (err) {
      // pass
    }
  };

  private initHtml = () => {
    const formatHtmlBase64 = Buffer.from(this.props.html, "utf-8").toString(
      "base64"
    );
    this.executeScript(
      InjectScriptName.SetHTML,
      JSON.stringify({
        html: formatHtmlBase64,
        isDarkMode: this.props.isDrakMode,
      })
    );
  };

  render() {
    return (
      <WebView
        {...this.props}
        ref={this.webViewRef}
        originWhitelist={["*"]}
        source={{ uri: this.state.webviewUri }}
        allowFileAccess
        allowingReadAccessToURL={"file://"}
        onMessage={this.onMessage}
        androidLayerType={
          Platform.OS === "android" && Platform.Version === 29
            ? "hardware"
            : "none"
        }
      />
    );
  }
}
