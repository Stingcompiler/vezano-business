import type { Decorator, Preview } from "@storybook/react-vite";

import "@sting/design/fonts.css";
import "../src/styles.css";

// dir="rtl" وlang="ar" على الجذر لكل قصة (القاعدة 1 من الأمر)
const withRtlRoot: Decorator = (Story) => {
  document.documentElement.setAttribute("dir", "rtl");
  document.documentElement.setAttribute("lang", "ar");
  return Story();
};

const preview: Preview = {
  parameters: {
    a11y: { test: "error" },
    backgrounds: {
      default: "page",
      values: [
        { name: "page", value: "#F8FAFC" },
        { name: "card", value: "#FFFFFF" },
      ],
    },
  },
  decorators: [withRtlRoot],
};
export default preview;
