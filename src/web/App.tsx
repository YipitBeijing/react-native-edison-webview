import { Buffer } from "buffer";
import React from "react";
import { EventName } from "../constants";
import QuotedControl from "./components/QuotedControl";
import "./styles";
import DarkModeUtil from "./utils/dark-mode";
import ImageDownload from "./utils/image-download";
import { addProxyForImage, handleImageLoadError } from "./utils/image-proxy";
import OversizeUtil from "./utils/oversize";
import QuotedHTMLTransformer from "./utils/quoted-html-transformer";
import ResizeUtil from "./utils/samrt-resize";
import SpecialHandle from "./utils/special-handle";

const darkModeStyle = `
  html, body.edo, #edo-container {
    background-color: #121212 !important;
  }
  body {
    color: #fff;
  }
`;

const lightModeStyle = `
  html, body.edo, #edo-container {
    background-color: #fffffe !important;
  }
`;

type EventType = typeof EventName[keyof typeof EventName];
type State = {
  isDarkMode: boolean;
  isPreviewMode: boolean;
  hasImgOrVideo: boolean;
  html: string;
  showHtml: string;
  platform?: "ios" | "android" | "windows" | "macos" | "web";
  disabeHideQuotedText: boolean;
  showQuotedText: boolean;
};

class App extends React.Component<any, State> {
  private hasImageInBody: boolean = true;
  private hasAllImageLoad: boolean = false;
  private ratio = 1;

  constructor(props: any) {
    super(props);
    this.state = {
      isDarkMode: false,
      isPreviewMode: false,
      hasImgOrVideo: false,
      html: "",
      showHtml: "",
      disabeHideQuotedText: false,
      showQuotedText: false,
    };
  }

  componentDidMount() {
    window.setHTML = this.setHTML;
    window.setPreviewMode = this.setPreviewMode;

    window.addEventListener("resize", () => {
      this.updateSize("window-resize");
    });
    this.postMessage(EventName.IsMounted, true);
  }

  componentDidUpdate(preProps: any, preState: State) {
    if (
      preState.showHtml !== this.state.showHtml ||
      preState.isDarkMode !== this.state.isDarkMode ||
      preState.isPreviewMode !== this.state.isPreviewMode
    ) {
      this.onContentChange();
    }
  }

  private postMessage = (type: EventType, data: any) => {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({
          type: type,
          data: data,
        })
      );
    }
  };

  private setHTML = (params: string) => {
    try {
      const {
        html,
        imageProxyTemplate,
        isDarkMode,
        disabeHideQuotedText,
        platform,
      } = JSON.parse(params);
      if (html) {
        const htmlStr = Buffer.from(html, "base64").toString("utf-8");
        // clear the meta to keep style
        const regMeta = /<meta\s+name=(['"\s]?)viewport\1\s+content=[^>]*>/gi;
        // clear @media for orientation: landscape
        const regOrientation =
          /@media screen and [:()\s\w-]*\(orientation: landscape\)/g;
        const formatHTML = htmlStr
          .replace(regMeta, "")
          .replace(regOrientation, "");
        const { hasImgOrVideo, html: addImageProxyHtml } = addProxyForImage(
          formatHTML,
          imageProxyTemplate
        );
        const { showQuotedText } = this.state;
        const showHtml =
          showQuotedText || disabeHideQuotedText
            ? addImageProxyHtml
            : QuotedHTMLTransformer.removeQuotedHTML(addImageProxyHtml);
        this.setState({
          html: addImageProxyHtml,
          showHtml,
          hasImgOrVideo,
          isDarkMode,
          platform,
          disabeHideQuotedText,
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  private setPreviewMode = (isPreviewMode: string) => {
    this.setState({ isPreviewMode: isPreviewMode === String(true) });
  };

  private updateSize = (info = "") => {
    if (info) {
      this.postMessage(EventName.Debugger, info);
    }
    if (document.fullscreenElement) {
      return;
    }

    const container = document.getElementById("edo-container");
    if (!container) {
      return;
    }

    this.postMessage(
      EventName.HeightChange,
      container.scrollHeight * this.ratio
    );
  };

  private onImageLoad = () => {
    this.updateSize("image-load");
    const container = document.getElementById("edo-container");
    if (!container) {
      return;
    }
    if (
      Array.from(container.querySelectorAll("img")).every((el) => {
        return el.complete;
      })
    ) {
      this.onAllImageLoad();
    }
  };

  private onAllImageLoad = () => {
    if (!this.hasAllImageLoad) {
      this.hasAllImageLoad = true;
      this.postMessage(EventName.OnLoadFinish, true);
    }
  };

  private applyDarkMode = () => {
    try {
      const container = document.getElementById("edo-container");
      if (!container) {
        return;
      }
      Array.from(container.querySelectorAll("*"))
        .reverse()
        .forEach((node) => {
          if (node instanceof HTMLElement) {
            DarkModeUtil.applyDarkModeForNode(node);
          }
        });
    } catch (err) {
      // pass
    }
  };

  private fixLongURL = () => {
    try {
      const container = document.getElementById("edo-container");
      if (!container) {
        return;
      }
      Array.from(container.querySelectorAll("a")).forEach((ele) => {
        OversizeUtil.fixLongURL(ele);
      });
    } catch (err) {
      // pass
    }
  };

  private limitImageWidth = () => {
    try {
      const container = document.getElementById("edo-container");
      if (!container) {
        return;
      }
      Array.from(container.querySelectorAll("img")).forEach((ele) => {
        OversizeUtil.limitImageWidth(ele, container.offsetWidth);
      });
    } catch (err) {
      // pass
    }
  };

  private addEventListenerForLink = () => {
    const container = document.getElementById("edo-container");
    if (!container) {
      return;
    }
    Array.from(container.querySelectorAll("a")).forEach((ele) => {
      ele.addEventListener("click", (e) => {
        e.preventDefault();
        this.postMessage(EventName.ClickLink, ele.href);
      });
    });
  };

  private addEventListenerForImage = () => {
    const container = document.getElementById("edo-container");
    if (!container) {
      return;
    }
    const images = Array.from(container.querySelectorAll("img"));

    this.hasImageInBody = images.length > 0;

    images.forEach((ele) => {
      // add load event to update webview size
      ele.addEventListener("load", this.onImageLoad);
      // add load error event to reset src
      ele.addEventListener("error", () => handleImageLoadError(ele));
      // add longPress event to download image
      if (this.state.platform != "ios") {
        const ImageDownloadUtil = new ImageDownload(ele, this.onImageDownload);
        ImageDownloadUtil.addEventListener();
      }
    });
  };

  private onImageDownload = (src: string) => {
    this.postMessage(EventName.onImageDownload, src);
  };

  private removeObjectDom = () => {
    const container = document.getElementById("edo-container");
    if (!container) {
      return;
    }
    Array.from(container.querySelectorAll("object")).forEach((ele) => {
      ele.addEventListener("click", (e) => {
        ele.style.display = "none";
      });
    });
  };

  private smartResize = () => {
    document.body.style.minWidth = "initial";
    document.body.style.width = "initial";
    const container = document.getElementById("edo-container");
    if (!container) {
      return;
    }
    const targetWidth = window.innerWidth;
    const originalWidth = container.scrollWidth;
    if (originalWidth > targetWidth) {
      this.ratio = targetWidth / originalWidth;
      try {
        ResizeUtil.scaleElement(container, originalWidth, this.ratio);
      } catch (err) {
        // pass
      }

      const sheets = document.styleSheets;
      try {
        for (const sheet of sheets) {
          ResizeUtil.zoomFontSizeInCss(sheet, 1.0 / this.ratio);
        }
      } catch (err) {
        // pass
      }

      const fontSizeElements = container.querySelectorAll(
        "*[style], font[size]"
      );
      try {
        for (const element of fontSizeElements) {
          if (element instanceof HTMLElement) {
            ResizeUtil.zoomText(element, 1.0 / this.ratio);
          }
        }
      } catch (err) {
        // pass
      }
      try {
        if (container.scrollWidth > container.offsetWidth + 20) {
          const elements = container.querySelectorAll(
            "td>a[style], td>span[style], td>font[size]"
          );
          for (const element of elements) {
            if (element instanceof HTMLElement) {
              ResizeUtil.scaleDownText(
                element,
                (container.offsetWidth - 20) / container.scrollWidth
              );
            }
          }
        }
      } catch (err) {
        // pass
      }

      document.body.style.height = container.offsetHeight * this.ratio + "px";
    }
    this.updateSize("html-reload");
  };

  private specialHandle = () => {
    try {
      const container = document.getElementById("edo-container");
      if (!container) {
        return;
      }
      Array.from(container.querySelectorAll("*")).forEach((node) => {
        if (node instanceof HTMLElement) {
          SpecialHandle.removeFacebookHiddenText(node);
        }
      });
    } catch (err) {
      // pass
    }
  };

  private onContentChange = () => {
    if (this.state.isDarkMode) {
      this.applyDarkMode();
    }
    this.addEventListenerForLink();
    this.addEventListenerForImage();
    this.removeObjectDom();
    this.fixLongURL();
    this.limitImageWidth();
    this.smartResize();
    this.specialHandle();

    if (this.state.isDarkMode) {
      this.debounceOnload();
    } else {
      this.onload();
    }

    if (!this.hasImageInBody) {
      this.onAllImageLoad();
    }
  };

  private onload = () => {
    this.postMessage(EventName.OnLoad, true);
  };

  private debounceOnload = debounce(this.onload, 300);

  private toggleshowQuotedText = () => {
    const { html, showQuotedText, disabeHideQuotedText } = this.state;
    const nextShowQuotedText = !showQuotedText;
    const showHtml =
      nextShowQuotedText || disabeHideQuotedText
        ? html
        : QuotedHTMLTransformer.removeQuotedHTML(html);
    this.setState({
      showQuotedText: nextShowQuotedText,
      showHtml,
    });
  };

  render() {
    const {
      html,
      showHtml,
      disabeHideQuotedText,
      isDarkMode,
      isPreviewMode,
      hasImgOrVideo,
    } = this.state;
    const containerStyles: React.CSSProperties =
      isPreviewMode && !hasImgOrVideo ? { padding: "2ex" } : {};
    return (
      <>
        <style>{isDarkMode ? darkModeStyle : lightModeStyle}</style>

        <div style={containerStyles}>
          <div dangerouslySetInnerHTML={{ __html: showHtml }}></div>
          {disabeHideQuotedText ? null : (
            <QuotedControl html={html} onClick={this.toggleshowQuotedText} />
          )}
        </div>
      </>
    );
  }
}

function debounce<T extends Array<any>>(
  fn: (...args: T) => void,
  delay: number
) {
  let timer: number | null = null; //????????????
  return function (...args: T) {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), delay);
  };
}

export default App;
