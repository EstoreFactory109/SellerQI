function resolve(prompt, classification, entities) {
  const { intent, responseStyle } = classification;

  let finalStyle = responseStyle;
  let chartType = "auto";

  if (finalStyle === "graph") {
    const hasTimeRange = !!entities.timeRange;
    if (hasTimeRange) {
      chartType = "line";
    } else {
      chartType = "bar";
    }
  }

  return {
    responseStyle: finalStyle,
    chartType
  };
}

module.exports = {
  resolve
};

