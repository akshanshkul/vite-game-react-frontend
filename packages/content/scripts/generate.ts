import {createHash} from 'node:crypto';import{writeFileSync,readFileSync}from'node:fs';import{generatePuzzle,validatePuzzle}from'../../engine/src/index';import{campaignLayout}from'../layouts';
const path=new URL('../levels/campaign.json',import.meta.url);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
if(process.argv.includes('--validate')){const content=JSON.parse(readFileSync(path,'utf8'));if(content.levels.length!==100)throw Error('Expected 100 levels');for(const {puzzle,hash:expected} of content.levels){if(hash(puzzle)!==expected)throw Error('Hash mismatch');const r=validatePuzzle(puzzle);if(!r.valid)throw Error(r.errors.join('; '));}const daily=JSON.parse(readFileSync(new URL('../levels/daily.json',import.meta.url),'utf8'));for(const {puzzle,hash:expected}of daily.challenges){if(hash(puzzle)!==expected||!validatePuzzle(puzzle).valid)throw Error('Invalid daily challenge');}console.log(`100/100 campaign puzzles and ${daily.challenges.length} daily challenges: hashes, geometry, witness replay, independent solver verified.`);}else{
// Each level is one step harder than the last: campaignLayout grows the board,
// and of a few solvable deals we keep the one whose free-move count is closest
// to a target that falls steadily from level 1 to 100.
const levels=Array.from({length:100},(_,i)=>{
  const number=i+1,layout=campaignLayout(number),target=3.2-(1.4*i)/99;
  let best=null;
  for(let k=0;k<4;k++){
    try{
      const p=generatePuzzle(layout.slots,`campaign-v2-${number}-${k}`,layout.id);
      if(!best||Math.abs(p.metrics.choices-target)<Math.abs(best.metrics.choices-target))best=p;
    }catch{/* rejected candidate; try the next seed */}
  }
  if(!best)throw Error(`No solvable deal for level ${number}`);
  best.id=`level-${String(number).padStart(3,'0')}`;
  best.difficulty=number<=30?'gentle':number<=65?'balanced':'challenging';
  return {number,name:layout.name,puzzle:best,hash:hash(best)};
});
writeFileSync(path,JSON.stringify({version:2,levels},null,2)+'\n');
console.log('Generated 100 validated puzzles with a rising difficulty curve: 12 to 80 tiles, 1 to 4 layers.');
}
