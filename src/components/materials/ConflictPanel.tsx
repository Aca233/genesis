"use client";
export function ConflictPanel({issues}:{issues:string[]}){if(!issues.length)return null;return <div className="rounded border border-cinnabar/40 bg-cinnabar/5 p-3 text-xs text-cinnabar"><p className="font-bold">以下问题会阻止创世：</p><ul className="mt-1 list-disc pl-5">{issues.map(x=><li key={x}>{x}</li>)}</ul></div>}
