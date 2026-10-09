/** Landmark catalog. No 3D code here, so the map can read it without loading Three.js. */
export interface Landmark {
  id: string;
  name: string;
  place: string;
  kind: string;
  lat: number;
  lon: number;
  /** First map zoom where the model shows. */
  minZoom: number;
}

export interface LandmarkInfo { blurb: string; facts: [string, string][] }

export const LANDMARKS: Landmark[] = [
  { id: 'eiffel', name: 'Eiffel Tower', place: 'Paris, France', kind: 'Tower', lat: 48.8584, lon: 2.2945, minZoom: 5 },
  { id: 'giza', name: 'Great Pyramids of Giza', place: 'Giza, Egypt', kind: 'Ancient wonder', lat: 29.9792, lon: 31.1342, minZoom: 4 },
  { id: 'taj', name: 'Taj Mahal', place: 'Agra, India', kind: 'Mausoleum', lat: 27.1751, lon: 78.0421, minZoom: 4 },
  { id: 'liberty', name: 'Statue of Liberty', place: 'New York, United States', kind: 'Monument', lat: 40.6892, lon: -74.0445, minZoom: 5 },
  { id: 'opera', name: 'Sydney Opera House', place: 'Sydney, Australia', kind: 'Opera house', lat: -33.8568, lon: 151.2153, minZoom: 5 },
  { id: 'christ', name: 'Christ the Redeemer', place: 'Rio de Janeiro, Brazil', kind: 'Statue', lat: -22.9519, lon: -43.2105, minZoom: 5 },
  { id: 'burj', name: 'Burj Khalifa', place: 'Dubai, United Arab Emirates', kind: 'Skyscraper', lat: 25.1972, lon: 55.2744, minZoom: 5 },
  { id: 'bigben', name: 'Big Ben', place: 'London, United Kingdom', kind: 'Clock tower', lat: 51.5007, lon: -0.1246, minZoom: 6 },
  { id: 'colosseum', name: 'Colosseum', place: 'Rome, Italy', kind: 'Amphitheater', lat: 41.8902, lon: 12.4922, minZoom: 7 },
  { id: 'stpeters', name: "St. Peter's Basilica", place: 'Vatican City', kind: 'Basilica', lat: 41.9022, lon: 12.4539, minZoom: 7 },
  { id: 'pisa', name: 'Leaning Tower of Pisa', place: 'Pisa, Italy', kind: 'Bell tower', lat: 43.723, lon: 10.3966, minZoom: 6 },
  { id: 'sagrada', name: 'Sagrada Família', place: 'Barcelona, Spain', kind: 'Basilica', lat: 41.4036, lon: 2.1744, minZoom: 6 },
  { id: 'basil', name: "St. Basil's Cathedral", place: 'Moscow, Russia', kind: 'Cathedral', lat: 55.7525, lon: 37.6231, minZoom: 5 },
  { id: 'parthenon', name: 'Parthenon', place: 'Athens, Greece', kind: 'Ancient temple', lat: 37.9715, lon: 23.7267, minZoom: 6 },
  { id: 'stonehenge', name: 'Stonehenge', place: 'Wiltshire, United Kingdom', kind: 'Stone circle', lat: 51.1789, lon: -1.8262, minZoom: 7 },
  { id: 'petronas', name: 'Petronas Towers', place: 'Kuala Lumpur, Malaysia', kind: 'Skyscraper', lat: 3.1579, lon: 101.7116, minZoom: 5 },
  { id: 'angkor', name: 'Angkor Wat', place: 'Siem Reap, Cambodia', kind: 'Temple', lat: 13.4125, lon: 103.867, minZoom: 5 },
  { id: 'chichen', name: 'Chichén Itzá', place: 'Yucatán, Mexico', kind: 'Pyramid', lat: 20.6843, lon: -88.5678, minZoom: 5 },
  { id: 'goldengate', name: 'Golden Gate Bridge', place: 'San Francisco, United States', kind: 'Bridge', lat: 37.8199, lon: -122.4783, minZoom: 5 },
  { id: 'needle', name: 'Space Needle', place: 'Seattle, United States', kind: 'Observation tower', lat: 47.6205, lon: -122.3493, minZoom: 6 },
];

export const MIN_LANDMARK_ZOOM = Math.min(...LANDMARKS.map(l => l.minZoom));
export const byId = (id: string) => LANDMARKS.find(l => l.id === id);

export const INFO: Record<string, LandmarkInfo> = {
  eiffel: { blurb: 'Built as the entrance arch to the 1889 World\'s Fair, it was meant to stand for twenty years. Parisians first hated it; now it is the city\'s symbol. It is repainted by hand about every seven years.', facts: [['Built', '1887–1889'], ['Height', '330 m (1,083 ft)'], ['Engineers', 'Gustave Eiffel\'s company'], ['Record', 'Tallest structure on Earth until 1930']] },
  giza: { blurb: 'The Great Pyramid was the tomb of the pharaoh Khufu. It is the oldest of the Seven Wonders of the Ancient World and the only one still standing. Beside it sit the pyramids of Khafre and Menkaure, and the Sphinx.', facts: [['Built', 'c. 2560 BC'], ['Original height', '146.6 m (481 ft)'], ['Blocks', 'About 2.3 million stones'], ['Record', 'Tallest built structure for about 3,800 years']] },
  taj: { blurb: 'Emperor Shah Jahan built it as a tomb for his wife Mumtaz Mahal. The white marble changes color through the day, and the four minarets lean slightly outward so they would fall away from the tomb in an earthquake.', facts: [['Built', '1632–1653'], ['Height', 'About 73 m (240 ft)'], ['Material', 'White Makrana marble'], ['Status', 'UNESCO World Heritage Site, 1983']] },
  liberty: { blurb: 'A gift from France to the United States, designed by Frédéric Auguste Bartholdi with an iron frame by Gustave Eiffel. It was shipped in 350 pieces and put together on Liberty Island. Its green color is natural copper patina.', facts: [['Dedicated', 'October 28, 1886'], ['Height', '93 m (305 ft) with pedestal'], ['Statue only', '46 m (151 ft)'], ['Material', 'Copper over an iron frame']] },
  opera: { blurb: 'Danish architect Jørn Utzon won the design competition in 1957, then left the project before it was done. The sails are built from precast concrete ribs covered in over a million glossy white and cream tiles.', facts: [['Opened', '1973'], ['Architect', 'Jørn Utzon'], ['Roof tiles', 'More than 1 million'], ['Status', 'UNESCO World Heritage Site, 2007']] },
  christ: { blurb: 'An Art Deco statue of Jesus with open arms, looking over Rio from the top of Corcovado mountain. It is made of reinforced concrete covered in thousands of small soapstone tiles.', facts: [['Completed', '1931'], ['Height', '30 m (98 ft) plus an 8 m pedestal'], ['Arm span', '28 m (92 ft)'], ['Designer', 'Paul Landowski and Heitor da Silva Costa']] },
  burj: { blurb: 'The tallest building in the world. Its Y-shaped plan, inspired by a desert flower, and stepped wings spiral upward to reduce the force of the wind. On a clear day it can be seen from 95 km away.', facts: [['Opened', '2010'], ['Height', '828 m (2,717 ft)'], ['Floors', '163'], ['Architect', 'Adrian Smith, SOM']] },
  bigben: { blurb: '"Big Ben" is really the name of the great bell inside; the tower is the Elizabeth Tower (renamed in 2012). Its clock faces are about 7 meters across, and the clock is still kept accurate by adding old pennies to the pendulum.', facts: [['Completed', '1859'], ['Height', '96 m (316 ft)'], ['Style', 'Gothic Revival, designed with Augustus Pugin'], ['Bell', 'About 13.7 tonnes']] },
  colosseum: { blurb: 'The largest amphitheater ever built, used for gladiator fights and public spectacles. Earthquakes and stone robbing took down the southern side, which is why one part of the outer wall is missing.', facts: [['Built', 'AD 70–80'], ['Size', '189 × 156 m, 48 m tall'], ['Capacity', 'About 50,000 people'], ['Status', 'UNESCO World Heritage Site, 1980']] },
  stpeters: { blurb: 'The largest church in the world by interior space and the center of the Catholic Church. Michelangelo designed the dome, and Bernini designed the oval colonnade that opens like two arms around the square.', facts: [['Consecrated', '1626'], ['Dome', 'Michelangelo, finished 1590'], ['Height', '136 m (448 ft)'], ['Colonnade', 'Bernini, 1656–1667']] },
  pisa: { blurb: 'The bell tower of Pisa Cathedral started leaning during construction because it sits on soft ground. Engineers finished a stabilizing project in 2001 that reduced the tilt, and it is now safe for centuries.', facts: [['Built', '1173–1372'], ['Height', 'About 56 m (183 ft)'], ['Tilt', 'About 4 degrees'], ['Steps', '251 to the top']] },
  sagrada: { blurb: 'Antoni Gaudí took over this basilica in 1883 and worked on it for the rest of his life. Construction has gone on for more than 140 years, paid for by donations and ticket sales. Its towers are meant to evoke trees in a forest.', facts: [['Begun', '1882'], ['Architect', 'Antoni Gaudí (d. 1926)'], ['Tallest tower', 'Planned 172.5 m (566 ft)'], ['Status', 'Still under construction']] },
  basil: { blurb: 'Ivan the Terrible had it built to celebrate the capture of Kazan. Eight chapels surround a ninth in the center, each topped with its own colorful onion dome. Legend says the architect was blinded so he could never make anything as beautiful again.', facts: [['Built', '1555–1561'], ['Height', 'About 65 m (213 ft)'], ['Chapels', 'Nine'], ['Location', 'Red Square, Moscow']] },
  parthenon: { blurb: 'A temple to the goddess Athena on the Acropolis, a symbol of ancient Greece and of democracy. It was a temple, a treasury, a church and a mosque before an explosion in 1687 ruined its roof.', facts: [['Built', '447–432 BC'], ['Architects', 'Iktinos and Kallikrates'], ['Columns', '8 across the ends, 17 along the sides'], ['Style', 'Doric']] },
  stonehenge: { blurb: 'A ring of huge standing stones raised over several centuries in prehistoric Britain. The smaller bluestones were brought from the Preseli Hills in Wales, about 150 miles away. Its purpose is still debated, and it lines up with the midsummer sunrise.', facts: [['Raised', 'c. 3000–2000 BC'], ['Big stones', 'Up to about 25 tonnes each'], ['Bluestones', 'From Wales'], ['Status', 'UNESCO World Heritage Site, 1986']] },
  petronas: { blurb: 'Twin towers whose floor plan is an eight-pointed star, a pattern from Islamic art. They were the tallest buildings in the world from 1998 to 2004, and they are joined by a two-story sky bridge.', facts: [['Completed', '1998'], ['Height', '452 m (1,483 ft)'], ['Floors', '88'], ['Architect', 'César Pelli']] },
  angkor: { blurb: 'The largest religious monument in the world, built by King Suryavarman II as a temple to Vishnu and later used by Buddhists. Five towers shaped like lotus buds stand for Mount Meru, and it is on the flag of Cambodia.', facts: [['Built', 'Early 12th century'], ['Central tower', 'About 65 m (213 ft)'], ['Moat', 'About 190 m wide'], ['Status', 'UNESCO World Heritage Site, 1992']] },
  chichen: { blurb: 'El Castillo, the temple of Kukulcán, was built by the Maya. Each of its four stairways has 91 steps, which together with the top platform makes 365, one for each day of the year. At the equinoxes the sun makes a snake of shadow slide down the north stairs.', facts: [['Built', 'c. 9th–12th century'], ['Height', 'About 30 m (98 ft)'], ['Steps', '91 on each of four sides'], ['Status', 'UNESCO World Heritage Site, 1988']] },
  goldengate: { blurb: 'Its color is called International Orange. When it opened it was the longest suspension bridge main span in the world. The towers rise out of the water and the bridge is often wrapped in fog.', facts: [['Opened', 'May 27, 1937'], ['Main span', '1,280 m (4,200 ft)'], ['Tower height', '227 m (746 ft)'], ['Engineer', 'Joseph Strauss, Charles Ellis, Leon Moisseiff']] },
  needle: { blurb: 'Built for the 1962 World\'s Fair, the Century 21 Exposition, in just 400 days. The saucer-shaped top holds an observation deck and a restaurant, and it is designed to stand through earthquakes and strong winds.', facts: [['Built', '1962'], ['Height', '184 m (605 ft)'], ['Built in', '400 days'], ['Built for', 'Seattle World\'s Fair']] },
};
