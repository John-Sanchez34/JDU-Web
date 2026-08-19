/**
 * Every piece of studio copy that appears on the public site lives here so the
 * owner can change it without touching page code. Replace these placeholder
 * values with the real studio details before launch.
 */
export const studio = {
  name: "Dance Studio",
  /** Two or three words. It is set very large, so a full sentence will not fit. */
  heroHeadline: "Every age. Every level.",
  tagline: "Classes for every age, from first steps to advanced technique.",
  phone: "(555) 555-0134",
  email: "hello@example.com",
  address: ["123 Main Street", "Springfield, IL 62701"],
  hours: [
    "Monday – Thursday: 3:30 PM – 9:00 PM",
    "Friday: 3:30 PM – 7:00 PM",
    "Saturday: 9:00 AM – 2:00 PM",
    "Sunday: Closed",
  ],
  staff: [
    {
      name: "Placeholder Instructor",
      title: "Artistic Director",
      bio: "Replace this entry with real staff details before launch.",
    },
  ],
} as const;

/** Digits only, for `tel:` links. */
export const studioPhoneHref = `tel:${studio.phone.replace(/[^\d+]/g, "")}`;
