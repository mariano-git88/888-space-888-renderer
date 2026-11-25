// Curated public research paths. Source identities are verified via the linked
// official sites/publisher/gallery pages, not inferred from a random name match.
// Listed accounts are research targets, not proof that Gaetano follows them.
const roster=Object.freeze([
  {instagramUsername:'micahlexier',name:'Micah Lexier',officialSource:'https://www.thepowerplant.org/whats-on/exhibitions/one-and-two-and-more-than-two',questions:['How can a count become a material rule?','How can collaborators retain authorship in an edition?']},
  {instagramUsername:'monkpictures',name:'Jonathan Monk — Restaurant Drawings',officialSource:'https://caseykaplangallery.com/?exhibitions=restaurant-drawings',questions:['Can the price of a work be a rule inside the work?','What does Instagram change about a limited edition?']},
  {instagramUsername:'davidhorvitz',name:'David Horvitz',officialSource:'https://davidhorvitz.com/',questions:['What does a work become when it travels as mail or an instruction?','Can distribution be part of its medium?']},
  {instagramUsername:'mailart.pt',name:'MAILART.PT',officialSource:'https://mailart.pt/about',questions:['What does a received paper sheet make possible?','What records should a correspondence archive preserve?']},
  {instagramUsername:'newdocuments',name:'New Documents',officialSource:'https://new-documents.org/',questions:['How can a publication alter how a work is read?','Which printed and digital formats remain distinct?']},
  {instagramUsername:'bookworksuk',name:'Book Works',officialSource:'https://bookworks.org.uk/about/',questions:['What does professional book production change in the work?','Can an edition carry its fabrication record?']}
]);
export function publicReadingMap(){
  return {
    purpose:'Curated starting points for independently verified research, not evidence of following, collaborations, media access or permissions to reproduce art.',
    attribution:'Source URLs are publicly documented by the artist, publisher, gallery or archive.',
    targets:roster.map(a=>({instagramUsername:a.instagramUsername,name:a.name,officialSource:a.officialSource,openQuestions:a.questions.slice()}))
  };
}
