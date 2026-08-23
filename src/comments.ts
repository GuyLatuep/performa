/**
 * What posting a comment on this issue can mean.
 *
 * On a service-desk issue a comment is either an internal note or a customer
 * reply, and which one decides who can read it. Everywhere else there is no
 * such choice: the comment is as visible as the issue itself, and offering
 * "internal" there would claim a privacy property that does not exist. See
 * CONTEXT.md.
 */
export interface CommentAction {
  /** Button label — the name of the thing being posted, from the glossary. */
  label: string;
  /** Whether the customer can read it. Sent to Jira as the `public` flag,
   *  which Jira ignores outside service-desk projects. */
  public: boolean;
  /** Who will be able to read the result, spelled out. */
  title: string;
}

/**
 * The comment actions to offer, in button order.
 *
 * The internal note comes first on purpose: the customer reply is the one with
 * consequences outside the team, and it should not be the button that muscle
 * memory finds.
 */
export function commentActions(serviceDesk: boolean): CommentAction[] {
  if (!serviceDesk) {
    return [
      {
        label: "Comment",
        public: true,
        title: "Visible to everyone who can see this issue",
      },
    ];
  }
  return [
    {
      label: "Internal note",
      public: false,
      title: "Only people working the issue can read this",
    },
    {
      label: "Reply to customer",
      public: true,
      title: "The customer who raised this request will see it",
    },
  ];
}
