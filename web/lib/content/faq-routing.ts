export const AUTO_ROUTING_COPY = {
  question: { en: "How does automatic model routing work?", zh: "模型自动路由如何工作？" },
  answer: {
    en: "With /model auto, each turn uses your declared default model unless you configure [auto.router] or enable [auto] cost_saving. No default classifier runs, and holding a DeepSeek key does not select one. /router (also /model router) offers Jev, Fast, Off and Custom presets. A configured classifier needs its provider credentials; unavailable or failed routing falls back to the declared default or the enabled fast sibling. Check the route in the Turn Inspector with Ctrl+Alt+O or /turn inspect.",
    zh: "使用 /model auto 时，每个回合采用你声明的默认模型，除非你配置了 [auto.router] 或启用了 [auto] cost_saving。默认不会调用分类器，拥有 DeepSeek 密钥也不会自动选定一个。/router（也可用 /model router）提供 Jev、Fast、Off 和 Custom 预设。已配置的分类器需要相应提供商凭据；路由不可用或失败时，会回退到声明的默认模型或已启用的快速同系列模型。用 Ctrl+Alt+O 或 /turn inspect 在回合检查器中查看实际路由。",
  },
  cache: {
    en: "Each turn sends the context it needs, including project instructions and tool definitions. Cache behavior depends on the provider, model and stable prompt prefix. Choose a smaller model explicitly when suitable; automatic routing changes models only through the settings you choose. Check /turn inspect for the route, tokens and reported cost.",
    zh: "每个回合会发送所需上下文，包括项目说明和工具定义。缓存行为取决于提供商、模型和稳定的提示前缀。适合时请明确选择较小的模型；自动路由仅按你选择的设置切换模型。用 /turn inspect 查看实际路由、token 与报告的费用。",
  },
};
