# GrowMate UI conventions

GrowMate is a Japanese SaaS for marketing beginners (SEO, Google Search Console, GA4, Google Ads). Its UI is shadcn/ui (new-york, neutral) on Tailwind CSS v4. Write all user-facing text in Japanese, following `guidelines/ui-text.md`. PC-first: lay out for desktop widths.

## Setup

No provider is needed. Load `styles.css` and use `window.GrowMate.*`. Render `<Toaster />` once and call `toast.success(...)` / `toast.error(...)` / `toast.loading(...)` for operation results.

## Styling: Tailwind utility classes on semantic tokens

Style everything with `className`. Use the semantic token classes, not raw colors:

| Role | Classes |
|---|---|
| Surfaces | `bg-background`, `bg-card`, `bg-muted`, `bg-secondary`, `bg-popover` |
| Text | `text-foreground`, `text-muted-foreground`, `text-primary-foreground`, `text-destructive` |
| Brand / action | `bg-primary` (near-black), `bg-destructive` |
| Lines | `border`, `border-border`, `border-input` |
| Radius | `rounded-md`, `rounded-lg`, `rounded-xl` |

The stylesheet is compiled from the classes GrowMate's codebase already uses, so only those exist. Stick to common ones: `flex`, `grid`, `grid-cols-1|2|4|6`, `md:grid-cols-2|3|4`, `lg:grid-cols-2|3|4`, `gap-1|2|3|4|6|8`, `p-2|3|4|6|8`, `px-2|3|4|6`, `py-2|3|4|6|8`, `space-y-2|3|4|6|8`, `text-xs|sm|base|lg|xl|2xl|3xl`, `font-medium|semibold|bold`, `max-w-sm|md|lg|2xl|4xl|6xl|7xl`. If a class you need does not take effect, use an inline `style` instead of guessing another class.

Read `styles.css` and `_ds_bundle.css` for the full token and class list, and each `components/general/<Name>/<Name>.prompt.md` for usage.

## Components

- `Button` variants: `default` (primary action), `secondary`, `outline` (cancel / secondary action), `ghost`, `destructive`, `link`. Sizes: `sm`, `default`, `lg`, `icon`.
- `Badge` variants: `default`, `secondary`, `destructive`, `outline`.
- `Alert` variants: `default`, `success`, `destructive`. Compose with `AlertTitle` and `AlertDescription`. GrowMate usually omits icons in alerts (`Alert` has no icon slot styling).
- Compounds: `Card` (`CardHeader`, `CardTitle`, `CardDescription`, `CardContent`), `Table` (`TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`), `Dialog` (`DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`), `Tabs` (`TabsList`, `TabsTrigger`, `TabsContent`), `Select` (`SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`), `DropdownMenu` (`DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`), `Sheet` (`SheetTrigger`, `SheetContent`, `SheetTitle`).
- Icons are lucide-react under `Icons`, e.g. `Icons.SearchIcon`, `Icons.DownloadIcon`, `Icons.Loader2Icon`. Never use emoji as icons.

## UX rules

- One clearly visible primary `Button` per screen area. Cancel is `outline`.
- Right-align numeric table columns (`className="text-right"`).
- AI processing longer than a moment shows a spinner plus text such as 「生成中...」 (progress labels are `<verb>中...`, see `guidelines/ui-text.md`).
- Don't nest a dialog inside a dialog.

## Example

```jsx
const { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Badge } = window.GrowMate;

<div className="grid gap-4 md:grid-cols-2">
  <Card>
    <CardHeader>
      <div className="flex items-center justify-between">
        <CardTitle>Google Analytics 4</CardTitle>
        <Badge variant="outline">未設定</Badge>
      </div>
      <CardDescription>読了率や滞在時間を記事の評価に使います。</CardDescription>
    </CardHeader>
    <CardContent>
      <Button>連携する</Button>
    </CardContent>
  </Card>
</div>
```
