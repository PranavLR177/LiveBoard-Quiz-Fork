import type { Presentation } from './presentations';

function lesson(id:string,title:string,className:string,unit:string,topic:string,scenes:string[][]):Presentation {
  return {id,title,className,unit,topic,updated:0,slides:scenes.map(([title,body,detail,notes])=>({title,body,detail,notes,kicker:className,visual:'none'}))};
}

export const additionalLessons=[
  lesson('sample-lit-voice','Reading between the lines','AP Literature','Short fiction','Narrative voice',[
    ['What does the narrator reveal?', '“I never missed that house. Still, I kept its key on the ring.”', 'Which word puts the two sentences in tension?', 'Still signals a turn from the claim of indifference to a revealing action.'],
    ['Change the point of view','“She turned the key over twice before slipping it into her pocket.”','What can a reader infer now? What remains uncertain?', 'We see a gesture. We lose direct access to the claim that she never missed home.'],
    ['Test a second reading','A kept key might suggest nostalgia, guilt, or a practical plan to return.','Which reading best explains “never” and “still” together?', 'Ask for a claim supported by both diction and gesture.'],
    ['Write the commentary','The narrator insists on distance while carrying a physical link to the house.','Add one sentence explaining the effect on the reader.', 'A reader may begin to question how fully the narrator understands her own attachment.']
  ]),
  lesson('sample-bio-osmosis','Which way will water move?','AP Biology','Cell structure and function','Osmosis',[
    ['Two chambers, one membrane','Side A contains 0.1 M sucrose. Side B contains 0.3 M sucrose. Only water can cross.','At equal pressure, predict the net movement of water.', 'Net movement is toward side B, which has lower water potential.'],
    ['Follow individual molecules','Water molecules cross the membrane in both directions.','How can both directions occur while B gains water?', 'More molecules cross from A to B per unit time than cross back.'],
    ['Read the mass change','A model cell starts at 10.0 g and ends at 10.8 g in a dilute solution.','Calculate its percent mass change and explain the sign.', 'The increase is 8%. Net water uptake accounts for the positive value when solute stays inside.'],
    ['Design a fair comparison','Compare identical model cells in solutions of different sucrose concentrations.','Which variables should stay constant?', 'Keep initial internal solution, membrane area, time and temperature constant. Compare percent mass changes.']
  ])
];
