// Coach-supplied copy and cue times. Titles are navigation labels only.
export const COACHING_CUES = [
 {time:4.36,title:'相手の勢いを抑える',text:'トラップの前に相手に体を当てて、相手の勢いを殺す'},
 {time:4.72,title:'半身で受ける',text:'半身でファーストタッチをする。この際、左手で相手をブロックしつつ、相手の位置を確認'},
 {time:4.93,title:'届かない角度へ',text:'相手の届かない角度にファーストタッチを出す。'},
 {time:5.42,title:'シュートコースを作る',text:'ツータッチ目で相手が触らない位置に運び、シュートコースを作る'},
 {time:6.23,title:'腰を回して打つ',text:'腰を回旋させてシュートを打つ'},
];

export function cueAt(time) {
 if (!Number.isFinite(time)) return -1;
 return COACHING_CUES.findLastIndex(cue => time >= cue.time);
}
