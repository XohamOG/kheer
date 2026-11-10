/** Synthetic demo templates. Always minted with the synthetic label. */
export interface Template {
  skill: string;
  who: string;
  knowledge: string;
  sample: string;
}

export const TEMPLATES: Template[] = [
  {
    skill: "Resume review",
    who: "Sample recruiter (synthetic)",
    knowledge: `SYNTHETIC TEST MATERIAL. Not from a real recruiter.

1. Read the top third first. If the target role is unclear within ten seconds, cap the score at 5.
2. Every bullet needs an action, a number and a result. Under half of bullets with all three caps the score at 6.
3. Duties are not achievements. Flag any bullet starting with "Responsible for".
4. Tools listed without evidence of use count for nothing.
5. Gaps over six months need one honest line.
6. The most recent role carries the most detail.
7. Fix order: target role, strongest proof, then wording.`,
    sample: `SYNTHETIC RESUME

Sam Example, Operations
Responsible for managing a warehouse team.
Helped improve shipping processes.
Skills: Excel, SAP, Tableau, Python.
Led migration of inventory to a new system, cutting stock errors 38% across 3 sites in 9 months.
2021 to 2024 Operations Lead. 2017 to 2019 Coordinator.`,
  },
  {
    skill: "Pitch deck review",
    who: "Sample investor (synthetic)",
    knowledge: `SYNTHETIC TEST MATERIAL. Not from a real investor.

1. Slide one must say who has the problem and how often. No company history first.
2. Market size counts only if it is bottom-up: customers times price.
3. Traction beats vision. A real number on slide three lifts the score by 2.
4. Competition slides that claim "no competitors" cap the score at 4.
5. The ask states amount, runway in months and the next milestone.
6. More than 12 slides costs a point.`,
    sample: `SYNTHETIC DECK OUTLINE

1. Our story: founded in 2024 by two friends
2. Problem: shipping is hard
3. Market: $500B logistics industry
4. Product: AI platform for everything in logistics
5. Competition: none, we are first
6. Team
7. Ask: raising money to grow`,
  },
  {
    skill: "Cover letter review",
    who: "Sample hiring manager (synthetic)",
    knowledge: `SYNTHETIC TEST MATERIAL. Not from a real hiring manager.

1. The first line names the role and one specific reason for this company.
2. One story with a measurable result beats a list of traits.
3. "I am passionate" without evidence costs a point.
4. Under 250 words. Every paragraph over 5 lines costs a point.
5. Close with availability and a concrete next step.`,
    sample: `SYNTHETIC COVER LETTER

Dear Sir or Madam,
I am passionate about technology and I am a hard worker and team player. I have always loved your company. In my last job I did many projects and learned a lot about many things. I believe I would be a great fit for any role you have.
Thank you for your time.`,
  },
];

export const templateFor = (skill: string) => TEMPLATES.find((t) => t.skill === skill);
