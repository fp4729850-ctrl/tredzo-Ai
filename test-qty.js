const price = 0.0701;
const budget = 10;
const rawQty = budget / price;
console.log('rawQty', rawQty);
fetch('https://fapi.binance.com/fapi/v1/exchangeInfo').then(r=>r.json()).then(d => {
  const sym = d.symbols.find(s => s.symbol === 'POLUSDT');
  const lot = sym.filters.find(f => f.filterType === 'LOT_SIZE');
  console.log(lot);
  const stepSize = lot.stepSize;
  const decimals = stepSize.includes('.') ? stepSize.split('.')[1].replace(/0+$/, '').length : 0;
  const factor = Math.pow(10, decimals);
  const qty = Math.floor(rawQty * factor) / factor;
  console.log('stepSize:', stepSize, 'decimals:', decimals, 'qty:', qty, 'string qty:', String(qty));
})
