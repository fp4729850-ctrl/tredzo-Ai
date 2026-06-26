# Graph Report - .  (2026-06-26)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 703 nodes · 1086 edges · 60 communities (52 shown, 8 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f5c6edfe`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Utility Libraries and Tools|Utility Libraries and Tools]]
- [[_COMMUNITY_Sheet UI Components|Sheet UI Components]]
- [[_COMMUNITY_Routing and Auth Context|Routing and Auth Context]]
- [[_COMMUNITY_UI Components and Helpers|UI Components and Helpers]]
- [[_COMMUNITY_Financial Charts and Backtesting|Financial Charts and Backtesting]]
- [[_COMMUNITY_Supabase and Strategy Pages|Supabase and Strategy Pages]]
- [[_COMMUNITY_TypeScript App Config|TypeScript App Config]]
- [[_COMMUNITY_Biome Linter Configuration|Biome Linter Configuration]]
- [[_COMMUNITY_UI Utility Components|UI Utility Components]]
- [[_COMMUNITY_Dashboard and Layout Components|Dashboard and Layout Components]]
- [[_COMMUNITY_Component Library and Utilities|Component Library and Utilities]]
- [[_COMMUNITY_Admin and Trade History|Admin and Trade History]]
- [[_COMMUNITY_TypeScript Node Config|TypeScript Node Config]]
- [[_COMMUNITY_Command Dialog Components|Command Dialog Components]]
- [[_COMMUNITY_Menubar UI Components|Menubar UI Components]]
- [[_COMMUNITY_Dev Dependencies and Tooling|Dev Dependencies and Tooling]]
- [[_COMMUNITY_Binance API Handlers|Binance API Handlers]]
- [[_COMMUNITY_Trading Signal Calculations|Trading Signal Calculations]]
- [[_COMMUNITY_Trading Signal Calculations|Trading Signal Calculations]]
- [[_COMMUNITY_TypeScript Check Config|TypeScript Check Config]]
- [[_COMMUNITY_File Upload and Dropzone|File Upload and Dropzone]]
- [[_COMMUNITY_Carousel UI Components|Carousel UI Components]]
- [[_COMMUNITY_Market Scan and Select UI|Market Scan and Select UI]]
- [[_COMMUNITY_TypeScript Project Config|TypeScript Project Config]]
- [[_COMMUNITY_Form Components and Context|Form Components and Context]]
- [[_COMMUNITY_Backtesting and Market Data|Backtesting and Market Data]]
- [[_COMMUNITY_Chart Components and Context|Chart Components and Context]]
- [[_COMMUNITY_User Settings and Strategies|User Settings and Strategies]]
- [[_COMMUNITY_Context Menu Components|Context Menu Components]]
- [[_COMMUNITY_Dropdown Menu Components|Dropdown Menu Components]]
- [[_COMMUNITY_Table UI Components|Table UI Components]]
- [[_COMMUNITY_Project Package Configuration|Project Package Configuration]]
- [[_COMMUNITY_Breadcrumb Navigation|Breadcrumb Navigation]]
- [[_COMMUNITY_Drawer UI Components|Drawer UI Components]]
- [[_COMMUNITY_Navigation Menu Components|Navigation Menu Components]]
- [[_COMMUNITY_Toggle UI Components|Toggle UI Components]]
- [[_COMMUNITY_Strategy Parameter Processing|Strategy Parameter Processing]]
- [[_COMMUNITY_Telegram Notification Integration|Telegram Notification Integration]]
- [[_COMMUNITY_Market Scan Data|Market Scan Data]]
- [[_COMMUNITY_Alert UI Components|Alert UI Components]]
- [[_COMMUNITY_OTP Input Components|OTP Input Components]]
- [[_COMMUNITY_Accordion UI Components|Accordion UI Components]]
- [[_COMMUNITY_Avatar UI Components|Avatar UI Components]]
- [[_COMMUNITY_Multi-Select UI Components|Multi-Select UI Components]]
- [[_COMMUNITY_Tabs UI Components|Tabs UI Components]]
- [[_COMMUNITY_QR Code Components|QR Code Components]]
- [[_COMMUNITY_Shell Script Checks|Shell Script Checks]]
- [[_COMMUNITY_Build Test Script|Build Test Script]]
- [[_COMMUNITY_Option Utilities|Option Utilities]]
- [[_COMMUNITY_Favicon Asset|Favicon Asset]]

## God Nodes (most connected - your core abstractions)
1. `cn()` - 97 edges
2. `compilerOptions` - 23 edges
3. `compilerOptions` - 16 edges
4. `Button` - 14 edges
5. `Badge()` - 11 edges
6. `compilerOptions` - 11 edges
7. `Skeleton()` - 10 edges
8. `AppLayout()` - 8 edges
9. `Card` - 8 edges
10. `CardHeader` - 8 edges

## Surprising Connections (you probably didn't know these)
- `Dropzone()` --calls--> `cn()`  [EXTRACTED]
  src/components/dropzone.tsx → src/lib/utils.ts
- `BreadcrumbSeparator()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/breadcrumb.tsx → src/lib/utils.ts
- `BreadcrumbEllipsis()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/breadcrumb.tsx → src/lib/utils.ts
- `CommandShortcut()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/command.tsx → src/lib/utils.ts
- `ContextMenuShortcut()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/context-menu.tsx → src/lib/utils.ts

## Import Cycles
- None detected.

## Communities (60 total, 8 thin omitted)

### Community 0 - "Utility Libraries and Tools"
Cohesion: 0.03
Nodes (66): dependencies, axios, class-variance-authority, clsx, cmdk, date-fns, embla-carousel-react, eventsource-parser (+58 more)

### Community 1 - "Sheet UI Components"
Cohesion: 0.05
Nodes (37): useIsMobile(), Separator, SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay (+29 more)

### Community 2 - "Routing and Auth Context"
Cohesion: 0.11
Nodes (15): IntersectObserver(), AppWrapper(), PageMeta(), PUBLIC_ROUTES, RouteGuard(), AuthContext, AuthContextType, AuthProvider() (+7 more)

### Community 3 - "UI Components and Helpers"
Cohesion: 0.12
Nodes (22): cn(), ConfidenceBar(), MarketScanPage(), SettingsPage(), ButtonProps, buttonVariants, Calendar(), CalendarDayButton() (+14 more)

### Community 4 - "Financial Charts and Backtesting"
Cohesion: 0.10
Nodes (20): CandlestickChart(), CandlestickChartProps, OHLCVBar, COMMON_SYMBOLS, MetricCard(), SavedBacktestRow(), TIMEFRAMES, getStrategies() (+12 more)

### Community 5 - "Supabase and Strategy Pages"
Cohesion: 0.13
Nodes (18): supabase, StrategiesPage(), deleteStrategy(), executeStrategy(), getAllTradesSummary(), updateStrategy(), RouteConfig, AlertDialogAction (+10 more)

### Community 6 - "TypeScript App Config"
Cohesion: 0.08
Nodes (25): compilerOptions, allowImportingTsExtensions, baseUrl, esModuleInterop, isolatedModules, jsx, lib, module (+17 more)

### Community 7 - "Biome Linter Configuration"
Cohesion: 0.08
Nodes (24): noUndeclaredDependencies, css, parser, files, includes, formatter, enabled, linter (+16 more)

### Community 8 - "UI Utility Components"
Cohesion: 0.08
Nodes (12): Params, Checkbox, HoverCardContent, PopoverContent, Progress, RadioGroup, RadioGroupItem, ScrollArea (+4 more)

### Community 9 - "Dashboard and Layout Components"
Cohesion: 0.14
Nodes (16): AppLayout(), navItems, SidebarNavProps, DashboardPage(), mockChartData, SignalRow(), StatCard(), TradeRow() (+8 more)

### Community 10 - "Component Library and Utilities"
Cohesion: 0.11
Nodes (17): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+9 more)

### Community 11 - "Admin and Trade History"
Cohesion: 0.18
Nodes (12): AdminStrategy, getAllStrategiesAdmin(), getTrades(), Strategy, Trade, Card, CardContent, CardDescription (+4 more)

### Community 12 - "TypeScript Node Config"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, lib, module, moduleDetection, moduleResolution, noEmit (+9 more)

### Community 13 - "Command Dialog Components"
Cohesion: 0.12
Nodes (14): Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut() (+6 more)

### Community 14 - "Menubar UI Components"
Cohesion: 0.12
Nodes (11): Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarLabel, MenubarRadioItem, MenubarSeparator, MenubarShortcut() (+3 more)

### Community 15 - "Dev Dependencies and Tooling"
Cohesion: 0.12
Nodes (16): devDependencies, autoprefixer, @biomejs/biome, postcss, tailwindcss, @tailwindcss/container-queries, @types/bmapgl, @types/lodash (+8 more)

### Community 16 - "Binance API Handlers"
Cohesion: 0.27
Nodes (13): baseUrl(), BinanceRequest, corsHeaders, getServiceClient(), getUserApiKeys(), handleBalance(), handleCancelOrder(), handleCreateOrder() (+5 more)

### Community 17 - "Trading Signal Calculations"
Cohesion: 0.16
Nodes (11): calcEMA(), calcRSI(), corsHeaders, evaluateSignal(), hmacSha256(), OHLCV, SignalResult, signedPost() (+3 more)

### Community 18 - "Trading Signal Calculations"
Cohesion: 0.18
Nodes (12): calcEMA(), calcRSI(), corsHeaders, evaluateSignal(), fetchKlines(), hmacSha256(), json(), OHLCV (+4 more)

### Community 19 - "TypeScript Check Config"
Cohesion: 0.13
Nodes (14): compilerOptions, allowImportingTsExtensions, jsx, lib, module, moduleResolution, noEmit, paths (+6 more)

### Community 20 - "File Upload and Dropzone"
Cohesion: 0.19
Nodes (11): Dropzone(), DropzoneContent(), DropzoneContext, DropzoneContextType, DropzoneEmptyState(), DropzoneProps, formatBytes(), useDropzoneContext() (+3 more)

### Community 21 - "Carousel UI Components"
Cohesion: 0.14
Nodes (12): Carousel, CarouselApi, CarouselContent, CarouselContext, CarouselContextProps, CarouselItem, CarouselNext, CarouselOptions (+4 more)

### Community 22 - "Market Scan and Select UI"
Cohesion: 0.24
Nodes (10): formatPrice(), formatVolume(), ScanRow(), SelectContent, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton (+2 more)

### Community 23 - "TypeScript Project Config"
Cohesion: 0.17
Nodes (11): compilerOptions, baseUrl, lib, module, paths, skipLibCheck, target, useDefineForClassFields (+3 more)

### Community 24 - "Form Components and Context"
Cohesion: 0.17
Nodes (9): FormControl, FormDescription, FormFieldContext, FormFieldContextValue, FormItem, FormItemContext, FormItemContextValue, FormLabel (+1 more)

### Community 25 - "Backtesting and Market Data"
Cohesion: 0.22
Nodes (9): BacktestTrade, calcEMA(), calcRSI(), corsHeaders, EquityPoint, OHLCV, runBacktest(), TF_MS (+1 more)

### Community 26 - "Chart Components and Context"
Cohesion: 0.18
Nodes (7): ChartConfig, ChartContainer, ChartContext, ChartContextProps, ChartLegendContent, ChartTooltipContent, THEMES

### Community 27 - "User Settings and Strategies"
Cohesion: 0.29
Nodes (5): callBinanceTrade(), createStrategy(), getUserSettings(), upsertUserSettings(), UserSettings

### Community 28 - "Context Menu Components"
Cohesion: 0.20
Nodes (9): ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuRadioItem, ContextMenuSeparator, ContextMenuShortcut(), ContextMenuSubContent (+1 more)

### Community 29 - "Dropdown Menu Components"
Cohesion: 0.20
Nodes (9): DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut(), DropdownMenuSubContent (+1 more)

### Community 30 - "Table UI Components"
Cohesion: 0.22
Nodes (8): Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow

### Community 31 - "Project Package Configuration"
Cohesion: 0.25
Nodes (7): name, scripts, build, dev, lint, type, version

### Community 32 - "Breadcrumb Navigation"
Cohesion: 0.25
Nodes (7): Breadcrumb, BreadcrumbEllipsis(), BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator()

### Community 33 - "Drawer UI Components"
Cohesion: 0.25
Nodes (6): DrawerContent, DrawerDescription, DrawerFooter(), DrawerHeader(), DrawerOverlay, DrawerTitle

### Community 34 - "Navigation Menu Components"
Cohesion: 0.25
Nodes (7): NavigationMenu, NavigationMenuContent, NavigationMenuIndicator, NavigationMenuList, NavigationMenuTrigger, navigationMenuTriggerStyle, NavigationMenuViewport

### Community 35 - "Toggle UI Components"
Cohesion: 0.33
Nodes (5): ToggleGroup, ToggleGroupContext, ToggleGroupItem, Toggle, toggleVariants

### Community 38 - "Market Scan Data"
Cohesion: 0.40
Nodes (3): BinanceTicker, corsHeaders, ScanItem

### Community 39 - "Alert UI Components"
Cohesion: 0.40
Nodes (4): Alert, AlertDescription, AlertTitle, alertVariants

### Community 40 - "OTP Input Components"
Cohesion: 0.40
Nodes (4): InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot

### Community 41 - "Accordion UI Components"
Cohesion: 0.50
Nodes (3): AccordionContent, AccordionItem, AccordionTrigger

### Community 42 - "Avatar UI Components"
Cohesion: 0.50
Nodes (3): Avatar, AvatarFallback, AvatarImage

### Community 44 - "Tabs UI Components"
Cohesion: 0.50
Nodes (3): TabsContent, TabsList, TabsTrigger

## Knowledge Gaps
- **383 isolated node(s):** `check.sh script`, `testBuild.sh script`, `enabled`, `clientKind`, `useIgnoreFile` (+378 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `UI Components and Helpers` to `Sheet UI Components`, `Financial Charts and Backtesting`, `Supabase and Strategy Pages`, `UI Utility Components`, `Dashboard and Layout Components`, `Admin and Trade History`, `Command Dialog Components`, `Menubar UI Components`, `File Upload and Dropzone`, `Carousel UI Components`, `Market Scan and Select UI`, `Form Components and Context`, `Chart Components and Context`, `User Settings and Strategies`, `Context Menu Components`, `Dropdown Menu Components`, `Table UI Components`, `Breadcrumb Navigation`, `Drawer UI Components`, `Navigation Menu Components`, `Toggle UI Components`, `Alert UI Components`, `OTP Input Components`, `Accordion UI Components`, `Avatar UI Components`, `Tabs UI Components`?**
  _High betweenness centrality (0.150) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Utility Libraries and Tools` to `Project Package Configuration`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `Button` connect `Dashboard and Layout Components` to `Sheet UI Components`, `UI Components and Helpers`, `Financial Charts and Backtesting`, `Supabase and Strategy Pages`, `Admin and Trade History`, `File Upload and Dropzone`, `Carousel UI Components`, `Market Scan and Select UI`, `User Settings and Strategies`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **What connects `check.sh script`, `testBuild.sh script`, `enabled` to the rest of the system?**
  _383 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Utility Libraries and Tools` be split into smaller, more focused modules?**
  _Cohesion score 0.030303030303030304 - nodes in this community are weakly interconnected._
- **Should `Sheet UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.05426356589147287 - nodes in this community are weakly interconnected._
- **Should `Routing and Auth Context` be split into smaller, more focused modules?**
  _Cohesion score 0.10541310541310542 - nodes in this community are weakly interconnected._