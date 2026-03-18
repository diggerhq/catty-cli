import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center text-center px-4">
      <h1 className="text-4xl font-bold mb-4">Catty</h1>
      <p className="text-lg text-fd-muted-foreground mb-8 max-w-md">
        Run Claude Code in the cloud, control it from your phone
      </p>
      <Link
        href="/docs"
        className="inline-flex items-center rounded-lg bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-foreground hover:bg-fd-primary/90"
      >
        Get Started
      </Link>
    </main>
  );
}
