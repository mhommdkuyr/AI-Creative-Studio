export type EditCommand = { type:'split'|'delete'|'move'|'trim_start'|'trim_end'|'noop'; time?:number; startTime?:number; clipId?:string; message?:string };

function localCommand(text:string, clip:any):EditCommand {
  const s=text.toLowerCase().replace(/\s+/g,' ').trim();
  const num=s.match(/(\d+(?:[.,]\d+)?)/)?.[1];
  if(!clip) return {type:'noop',message:'أضف فيديو أولًا حتى أستطيع تعديل الـTimeline.'};
  if(/split|قسّم|قسم/.test(s)&&num) return {type:'split',time:Number(num.replace(',','.')),clipId:clip.id,message:`قسّمت المقطع عند ${num} ثانية.`};
  if(/delete|remove|احذف|حذف/.test(s)) return {type:'delete',clipId:clip.id,message:'حذفت المقطع المحدد.'};
  if(/move|حرّك|حرك/.test(s)&&num) return {type:'move',startTime:Number(num.replace(',','.')),clipId:clip.id,message:`نقلت المقطع إلى ${num} ثانية.`};
  if(/trim|قص|اقطع|أول/.test(s)&&num) return {type:'trim_start',time:Number(num.replace(',','.')),clipId:clip.id,message:`قصصت بداية المقطع إلى ${num} ثانية.`};
  return {type:'noop',message:'لم أفهم الأمر بعد.'};
}

export async function parseWithOpenAI(text:string, timeline:any, fallback:EditCommand):Promise<EditCommand> {
  const clip=timeline?.tracks?.find((t:any)=>t.type==='video')?.clips?.[0];
  const local=localCommand(text,clip);
  const key=process.env.OPENAI_API_KEY;
  if(!key) return local.type==='noop'?fallback:local;
  const model=process.env.OPENAI_MODEL || 'gpt-5.6-luna';
  const tool={type:'function',name:'edit_timeline',description:'Change the active video timeline clip.',parameters:{type:'object',properties:{type:{type:'string',enum:['split','delete','move','trim_start','trim_end','noop']},time:{type:'number',minimum:0},startTime:{type:'number',minimum:0},clipId:{type:'string'}},required:['type'],additionalProperties:false},strict:true};
  try {
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${key}`},body:JSON.stringify({model,input:`Video timeline command. The active clip is ${JSON.stringify(clip||{})}. User request: ${text}`,tools:[tool],tool_choice:{type:'function',name:'edit_timeline'}})});
    if(!response.ok) return local.type==='noop'?fallback:local;
    const data:any=await response.json();
    const call=(data.output||[]).find((item:any)=>item.type==='function_call'&&item.name==='edit_timeline');
    if(!call) return local.type==='noop'?fallback:local;
    const args=JSON.parse(call.arguments||'{}');
    return {...args,clipId:args.clipId||clip?.id,message:'تم تفسير الأمر عبر OpenAI Tool Calling.'} as EditCommand;
  } catch {
    return local.type==='noop'?fallback:local;
  }
}
