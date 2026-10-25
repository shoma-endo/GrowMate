import { Button, Icons, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from 'growmate-ui';

export const Open = () => (
  <TooltipProvider>
    <div className="flex h-32 items-end justify-center">
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="CTR とは">
            <Icons.HelpCircleIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>CTR は、表示された回数のうちクリックされた割合です</TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);
