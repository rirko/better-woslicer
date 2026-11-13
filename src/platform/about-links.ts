import creditLinks from './about-links.json';

export { creditLinks };
export type AboutLink = 'project' | keyof typeof creditLinks;
