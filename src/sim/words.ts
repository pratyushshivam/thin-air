// The log: what you saw and what it means. Every figure here has a source in the README.

export interface Entry {
  title: string;
  text: string;
}

export const LOG: Record<string, Entry> = {
  bc: {
    title: "Base Camp",
    text: "A village of tents on moving ice at the foot of the Khumbu Icefall. The usual figure is 5,364 m; the glacier has thinned, and the satellite model this mountain is built from reads about 5,290 m where the route begins. On 25 April 2015 an earthquake of magnitude 7.8 sent an avalanche off Pumori through this camp. Between 17 and 19 people died here; the counts differ.",
  },
  air: {
    title: "The air",
    text: "Air is 21% oxygen everywhere. What changes is how much air there is. At Base Camp the barometer reads about 400 mmHg against 760 at the sea, so each breath carries half the oxygen. On the summit it reads about 253, and each breath carries under a third.",
  },
  icefall: {
    title: "The Khumbu Icefall",
    text: "The glacier drops about 600 m here and breaks into towers and crevasses that shift by roughly a metre a day. A team of Sherpas, the Icefall Doctors, rebuild a way through it with ropes and ladders every season. On 18 April 2014 a block of ice fell from the west shoulder onto the route and killed 16 Nepali guides.",
  },
  serac: {
    title: "The ice moves",
    text: "Night cold locks the icefall in place. Sun loosens it, and the worst hours are mid to late afternoon. That is the whole reason for the 3 a.m. starts.",
  },
  c1: {
    title: "Camp I",
    text: "About 6,065 m, on the lip of the Western Cwm. Most people feel it here first: headache, no appetite, broken sleep. It is the body noticing that there is not enough oxygen, and beginning to do something about it.",
  },
  cwm: {
    title: "The Western Cwm",
    text: "Named by George Mallory in 1921 with the Welsh word for a valley. A flat glacier walled in by Everest, Lhotse and Nuptse, with no wind and snow on every side to throw the sun back at you.",
  },
  heat: {
    title: "Heat, at 6,200 metres",
    text: "The air here stays below freezing: a weather station at Camp II did not record one hour above 0 °C in May 2019. But sunlight in this bowl measures close to what it is above the atmosphere, and climbers in 1953 logged 37.8 °C inside their tents. You overheat standing on ice.",
  },
  c2: {
    title: "Camp II",
    text: "Advanced base, about 6,400 m, under the south-west face. Helicopters can still reach this high. Above here, nobody can come and get you.",
  },
  acclim: {
    title: "Climb high, sleep low",
    text: "Over days at altitude you breathe harder and deeper, which blows off carbon dioxide and leaves more room in the lungs for oxygen, and you make more red cells. It cannot be hurried. Expeditions go up and come back down for a month before they try for the top.",
  },
  bergschrund: {
    title: "The Lhotse Face",
    text: "Over a kilometre of hard blue ice at 40 to 50 degrees. You climb it clipped to a fixed rope, kicking the front points of your crampons into ice that does not want them.",
  },
  c3: {
    title: "Camp III",
    text: "Ledges cut into the Lhotse Face, somewhere between 7,100 and 7,470 m depending on the year and who is counting. Blood drawn at 7,100 m in 2007 still carried a nearly normal amount of oxygen, because by now it holds far more haemoglobin.",
  },
  oxygen: {
    title: "Bottled oxygen",
    text: "One cylinder holds about 1,040 litres: four litres of space filled to 260 bar. At 2 litres a minute that is under nine hours; at 4, just over four. The gas is mixed into the thin air you breathe, so it lowers the mountain rather than removing it. About 95% of everyone who has stood on top used it.",
  },
  yellow: {
    title: "The Yellow Band",
    text: "A belt of pale limestone and marble that was once the floor of a sea. You cross it in crampons, steel scraping on rock.",
  },
  geneva: {
    title: "The Geneva Spur",
    text: "A black rib of rock named by the Swiss expedition of 1952, who got to within about 250 m of the top the year before it was climbed. Over it lies the South Col.",
  },
  c4: {
    title: "The South Col",
    text: "7,906 m. The highest camp, on a saddle between the first and fourth highest mountains on Earth. A weather station here has recorded gusts over 180 km/h.",
  },
  deathzone: {
    title: "The death zone",
    text: "Above about 8,000 m there is too little oxygen to live on. The body cannot acclimatise; it only runs down. A Swiss doctor, Edouard Wyss-Dunant, named it in 1953. Everything from here is on a clock.",
  },
  colwait: {
    title: "A day on the Col",
    text: "Waiting here is not rest. You breathe a bottle of oxygen lying still, sleep little, eat almost nothing, and are weaker tomorrow than today. Two or three days is the most anyone stays.",
  },
  balcony: {
    title: "The Balcony",
    text: "A small shelf at about 8,430 m where the route gains the Southeast Ridge. In May 2019 a team bolted a weather station here, for a time the highest on Earth. Its first reading was −23.9 °C.",
  },
  cache: {
    title: "A fresh bottle",
    text: "Almost every climber changes oxygen cylinders at the Balcony. The spare was carried up and left here by Sherpas, who climb this mountain more times, with more weight, than anyone they guide.",
  },
  south: {
    title: "The South Summit",
    text: "8,749 m. From here you see the last of it for the first time: a narrow crest of snow with Nepal 2,400 m down on the left and Tibet 3,000 m down on the right.",
  },
  step: {
    title: "The Hillary Step",
    text: "Until 2015 this was 12 m of near-vertical rock, the last obstacle, first climbed by Edmund Hillary wedging himself up a crack between rock and ice. After the earthquake climbers found it changed: the great boulder is gone and it is now a slope of snow and broken rock.",
  },
  queue: {
    title: "A queue at 8,800 metres",
    text: "One rope, one direction at a time. When the weather gives a single good day, everybody takes it. Standing still here you make no heat, and your oxygen runs whether you move or not.",
  },
  summit: {
    title: "The summit",
    text: "8,848.86 m, as measured by Nepal and China together and announced on 8 December 2020. Tenzing Norgay and Edmund Hillary stood here first, at 11:30 on 29 May 1953. On 8 May 1978 Reinhold Messner and Peter Habeler reached it breathing only this air, which many doctors doubted a person could survive.",
  },
  storm: {
    title: "Weather",
    text: "On 10 May 1996 a storm came up from the valleys in the late afternoon, while climbers who had reached the top after their two o'clock turnaround time were still high on the ridge. Eight people died on the mountain that night and the next day.",
  },
  o2out: {
    title: "Empty",
    text: "When the bottle runs out the mountain is suddenly its full height again, and you are more tired than you were on the way up.",
  },
  turned: {
    title: "Turning round",
    text: "The summit is only halfway. Of the people who died above 8,000 m on Everest between 1921 and 2006, 56% died on the way down from the top, and another 17% after turning back. Those who lived summited, at the median, between nine and ten in the morning.",
  },
  fever: {
    title: "Summit fever",
    text: "You set that time in a tent, with oxygen, thinking clearly. You have just overruled yourself with a brain running on half its fuel.",
  },
  hape: {
    title: "Fluid in the lungs",
    text: "High-altitude pulmonary oedema. Low oxygen squeezes the lung's blood vessels until they leak. It comes on at night, to people who went up faster than their bodies could follow, and it kills within hours if they stay. Going down cures it.",
  },
};
