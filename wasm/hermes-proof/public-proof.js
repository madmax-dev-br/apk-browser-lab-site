(function(){
  var values=[2,3,5,7], result=values.map(function(x){return x*x;}).reduce(function(a,b){return a+b;},0);
  function makeAdder(x){return function(y){return x+y;};}
  print(JSON.stringify({engine:'official-Hermes-v0.13.0',expectedBytecode:96,sumSquares:result,closure:makeAdder(40)(2),caught:(function(){try{throw new Error('source-catch');}catch(e){return e.message;}})()}));
})();
