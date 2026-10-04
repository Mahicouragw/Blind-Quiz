function secureRandomInt(max){
  if(!Number.isInteger(max)||max<1)throw new RangeError('max must be a positive integer');
  if(globalThis.crypto?.getRandomValues){
    const limit=Math.floor(0x100000000/max)*max;
    const value=new Uint32Array(1);
    do{globalThis.crypto.getRandomValues(value)}while(value[0]>=limit);
    return value[0]%max;
  }
  return Math.floor(Math.random()*max);
}

// Unbiased Fisher-Yates shuffle when secureRandomInt uses Web Crypto rejection sampling.
export function shuffled(values,randomInt=secureRandomInt){
  const copy=[...values];
  for(let i=copy.length-1;i>0;i--){
    const j=randomInt(i+1);
    if(!Number.isInteger(j)||j<0||j>i)throw new RangeError('random index is out of range');
    [copy[i],copy[j]]=[copy[j],copy[i]];
  }
  return copy;
}
