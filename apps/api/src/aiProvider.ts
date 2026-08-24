export type EditCommand = { type:'split'|'delete'|'move'|'trim_start'|'trim_end'|'noop'; time?:number; startTime?:number; clipId?:string; message?:string };

export async function parseWithOpenAI(text:string, timeline:any, fallback:EditCommand):Promise<EditCommand> {
  const key=process.env.OPENAI_API_KEY;
  if(!key) return fallback;
  const model=process.env.OPENAI_MODEL || 'gpt-5.6-luna';
  const clip=timeline?.tracks?.find((t:any)=>t.type==='video')?.clips?.[0];
  const tool={type:'function',name:'edit_timeline',description:'Change the active video timeline clip.',parameters:{type:'object',properties:{type:{type:'string',enum:['split','delete','move','trim_start','trim_end','noop']},time:{type:'number',minimum:0},startTime:{type:'number',minimum:0},clipId:{type:'string'}},required:['type'],additionalProperties:false},strict:true};
  try {
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${key}`},body:JSON.stringify({model,input:`Video timeline command. The active clip is ${JSON.stringify(clip||{})}. User request: ${text}`,tools:[tool],tool_choice:{type:'function',name:'edit_timeline'}})});
    if(!response.ok) return fallback;
    const data:any=await response.json();
    const call=(data.output||[]).find((item:any)=>item.type==='function_call' && item.name==='edit_timeline');
    if(!call) return fallback;
    const args=JSON.parse(call.arguments||'{}');
    return { ...args, clipId:args.clipId||clip?.id, message:'تم تفسير الأمر عبر OpenAI Tool Calling.' } as EditCommand;
  } catch {
    return fallback;
  }
}
