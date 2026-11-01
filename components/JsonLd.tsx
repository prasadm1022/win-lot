// SPDX-License-Identifier: Apache-2.0

/** A schema.org JSON-LD block. `<` is escaped so no string in the data can close the script element. */
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />
}
