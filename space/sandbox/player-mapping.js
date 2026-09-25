export const playerMapping = {
 // Match anatomical regions: MOVE Spine1 is the upper chest, not the abdomen.
 // Intermediate helper bones retain their authored local offsets.
 hip: 'Hips', abdomenUpper: 'Spine', chestUpper: 'Spine1',
 neckLower: 'Neck', head: 'Head',
 lCollar: 'LeftShoulder', lShldrBend: 'LeftArm', lForearmBend: 'LeftForeArm', lHand: 'LeftHand',
 rCollar: 'RightShoulder', rShldrBend: 'RightArm', rForearmBend: 'RightForeArm', rHand: 'RightHand',
 lThighBend: 'LeftUpLeg', lShin: 'LeftLeg', lFoot: 'LeftFoot', lToe: 'LeftToeBase',
 rThighBend: 'RightUpLeg', rShin: 'RightLeg', rFoot: 'RightFoot', rToe: 'RightToeBase',
};
for (const [side, label] of [['l','Left'],['r','Right']]) {
 for (const [finger, suffix] of [['Thumb','Thumb'],['Index','Index'],['Mid','Middle'],['Ring','Ring'],['Pinky','Pinky']]) {
  for (let i=1;i<=3;i++) playerMapping[`${side}${finger}${i}`] = `${label}Hand${suffix}${i}`;
 }
}
