import Markdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

export default function ShowNotesView({ markdown }: { markdown: string }) {
  return (
    <article className="prose max-w-none">
      <Markdown rehypePlugins={[rehypeSanitize]}>{markdown}</Markdown>
    </article>
  );
}
