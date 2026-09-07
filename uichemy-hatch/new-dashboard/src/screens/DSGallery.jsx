import React from 'react';
import * as Icon from '../components/icons.jsx';
import {
  Button, Badge, Alert, Input, Field, Textarea, Checkbox,
  RadioGroup, RadioRow, Switch, Slider,
  Select, SelectValue, SelectTrigger, SelectContent, SelectItem,
  Tabs, TabsList, TabsTrigger, TabsContent,
  Card, CardHeader, CardTitle, CardDescription, CardBody, CardFooter,
  Tooltip, TooltipProvider,
  Dialog, DialogTrigger, DialogContent, DialogCard, DialogHeader,
  DialogTitle, DialogDescription, DialogBody, DialogFooter,
  Menu, MenuTrigger, MenuContent, MenuItem, MenuLabel, MenuSeparator,
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
  Popover, PopoverTrigger, PopoverContent,
  Separator, Skeleton, Toggle, ToggleGroup, ToggleGroupItem, Label,
} from '../design-system';

/* ------------------------------------------------------------------ *
 * DSGallery, a kitchen-sink of the whole UiChemy Create design system,
 * rendered with the REAL components + tokens so it reflects the current
 * monochrome (black + light-grey) theme exactly. Reachable via
 * ?nd_preview=ds-gallery. Scaffolding uses inline --uc-* tokens only, so
 * it stays on-theme without adding any CSS.
 * ------------------------------------------------------------------ */

const page = { background: 'var(--uc-surface-raised)', minHeight: '100vh', padding: '32px 40px 96px' };
const inner = { maxWidth: 1080, margin: '0 auto' };
const h1 = { fontSize: 'var(--uc-text-2xl)', fontWeight: 500, color: 'var(--uc-text-strong)', margin: '0 0 4px' };
const sub = { fontSize: 'var(--uc-text-base)', color: 'var(--uc-text-muted)', margin: '0 0 28px' };
const secTitle = { fontSize: 'var(--uc-text-sm)', fontWeight: 500, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--uc-text-muted)', margin: '0 0 14px' };
const rowStyle = { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' };
const colStyle = { display: 'flex', flexDirection: 'column', gap: 12 };

function Section({ title, children }) {
  return (
    <section style={{ padding: '22px 0', borderTop: '1px solid var(--uc-border-subtle)' }}>
      <h2 style={secTitle}>{title}</h2>
      {children}
    </section>
  );
}
function Row({ children, style }) { return <div style={{ ...rowStyle, ...style }}>{children}</div>; }
function Label2({ children }) {
  return <span style={{ fontSize: 'var(--uc-text-xs)', color: 'var(--uc-text-subtle)', width: 84, flexShrink: 0 }}>{children}</span>;
}

/* ---- color swatches ---- */
const SWATCHES = [
  ['Surface base', 'var(--uc-surface-base)'],
  ['Surface sunken', 'var(--uc-surface-sunken)'],
  ['Surface raised', 'var(--uc-surface-raised)'],
  ['Brand (primary)', 'var(--uc-brand)'],
  ['Text strong', 'var(--uc-text-strong)'],
  ['Text muted', 'var(--uc-text-muted)'],
  ['Border', 'var(--uc-border)'],
  ['Success', 'var(--uc-success)'],
  ['Danger', 'var(--uc-danger)'],
  ['Warning', 'var(--uc-warning)'],
];
function Swatch({ name, value }) {
  return (
    <div style={{ width: 132 }}>
      <div style={{ height: 56, borderRadius: 'var(--uc-radius-8)', background: value, border: '1px solid var(--uc-border-subtle)' }} />
      <div style={{ fontSize: 'var(--uc-text-xs)', color: 'var(--uc-text)', marginTop: 6 }}>{name}</div>
      <div style={{ fontSize: 'var(--uc-text-2xs)', color: 'var(--uc-text-subtle)', fontFamily: 'var(--uc-font-mono)' }}>{value.replace('var(--uc-', '').replace(')', '')}</div>
    </div>
  );
}

const TYPE = [
  ['3xl', 'var(--uc-text-3xl)'], ['2xl', 'var(--uc-text-2xl)'], ['xl', 'var(--uc-text-xl)'],
  ['lg', 'var(--uc-text-lg)'], ['base', 'var(--uc-text-base)'], ['sm', 'var(--uc-text-sm)'], ['xs', 'var(--uc-text-xs)'],
];

export default function DSGallery() {
  return (
    <TooltipProvider>
      <div style={page}>
      <div style={inner}>
        <h1 style={h1}>UiChemy Create, Design System</h1>
        <p style={sub}>Every component rendered live in the current monochrome (black + light-grey) theme.</p>

        <Section title="Color tokens">
          <Row style={{ gap: 16 }}>{SWATCHES.map(([n, v]) => <Swatch key={n} name={n} value={v} />)}</Row>
        </Section>

        <Section title="Typography">
          <div style={colStyle}>
            {TYPE.map(([n, v]) => (
              <div key={n} style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                <span style={{ width: 40, fontSize: 'var(--uc-text-xs)', color: 'var(--uc-text-subtle)', fontFamily: 'var(--uc-font-mono)' }}>{n}</span>
                <span style={{ fontSize: v, fontWeight: 500, color: 'var(--uc-text-strong)' }}>Zalando Sans</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Buttons">
          <div style={colStyle}>
            <Row><Label2>Solid</Label2>
              <Button variant="solid" tone="brand">Primary</Button>
              <Button variant="solid" tone="neutral">Neutral</Button>
              <Button variant="solid" tone="success">Success</Button>
              <Button variant="solid" tone="danger">Danger</Button>
            </Row>
            <Row><Label2>Soft</Label2>
              <Button variant="soft" tone="brand">Brand</Button>
              <Button variant="soft" tone="neutral">Neutral</Button>
              <Button variant="soft" tone="success">Success</Button>
              <Button variant="soft" tone="danger">Danger</Button>
            </Row>
            <Row><Label2>Outline</Label2>
              <Button variant="outline" tone="brand">Brand</Button>
              <Button variant="outline" tone="neutral">Neutral</Button>
            </Row>
            <Row><Label2>Ghost</Label2>
              <Button variant="ghost" tone="brand">Brand</Button>
              <Button variant="ghost" tone="neutral">Neutral</Button>
            </Row>
            <Row><Label2>Sizes</Label2>
              <Button size="sm" tone="brand">Small · 28px</Button>
              <Button size="md" tone="brand">Medium · 32px</Button>
              <Button size="lg" tone="brand">Large</Button>
            </Row>
            <Row><Label2>States</Label2>
              <Button tone="brand" loading>Loading</Button>
              <Button tone="brand" disabled>Disabled</Button>
              <Button tone="brand" iconOnly aria-label="Add"><Icon.Sparkles size={16} /></Button>
              <Button variant="outline" tone="neutral" iconOnly aria-label="Settings"><Icon.Gear size={16} /></Button>
            </Row>
          </div>
        </Section>

        <Section title="Badges">
          <div style={colStyle}>
            <Row><Label2>Soft</Label2>
              {['brand', 'neutral', 'success', 'danger', 'warning', 'accent'].map((t) => (
                <Badge key={t} variant="soft" tone={t}>{t}</Badge>
              ))}
            </Row>
            <Row><Label2>Solid</Label2>
              {['brand', 'neutral', 'success', 'danger'].map((t) => (
                <Badge key={t} variant="solid" tone={t}>{t}</Badge>
              ))}
            </Row>
            <Row><Label2>Outline</Label2>
              <Badge variant="outline" tone="neutral">outline</Badge>
              <Badge variant="soft" tone="success" dot>with dot</Badge>
              <Badge variant="soft" tone="brand" size="md">medium</Badge>
            </Row>
          </div>
        </Section>

        <Section title="Alerts">
          <div style={colStyle}>
            <Alert tone="accent" title="Heads up">This is an informational message using the accent tone.</Alert>
            <Alert tone="success" title="Saved">Your changes were saved successfully.</Alert>
            <Alert tone="warning" title="Careful">This action affects every connected site.</Alert>
            <Alert tone="danger" title="Something went wrong">We couldn't reach the server. Try again.</Alert>
          </div>
        </Section>

        <Section title="Form controls">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
            <div style={colStyle}>
              <Field label="Email" hint="We'll never share it.">
                <Input placeholder="you@example.com" />
              </Field>
              <Field label="Invalid input" error="This field is required.">
                <Input placeholder="Required" invalid defaultValue="" />
              </Field>
              <Field label="Message">
                <Textarea placeholder="Write something…" rows={3} />
              </Field>
              <div>
                <Label>Sort by</Label>
                <div style={{ marginTop: 6 }}>
                  <Select defaultValue="recent">
                    <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="recent">Most recent</SelectItem>
                      <SelectItem value="name">Name (A–Z)</SelectItem>
                      <SelectItem value="size">File size</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div style={colStyle}>
              <Row><Label2>Checkbox</Label2>
                <Checkbox defaultChecked /> <Checkbox /> <Checkbox size="lg" defaultChecked />
              </Row>
              <Row><Label2>Switch</Label2>
                <Switch defaultChecked /> <Switch /> <Switch size="sm" defaultChecked />
              </Row>
              <div>
                <Label2>Radio</Label2>
                <RadioGroup defaultValue="figma" style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <RadioRow value="figma" id="g-figma" label="Figma plugin" />
                  <RadioRow value="ai" id="g-ai" label="AI Website Creator" />
                  <RadioRow value="mcp" id="g-mcp" label="AI Agent (MCP)" />
                </RadioGroup>
              </div>
              <div>
                <Label2>Slider</Label2>
                <div style={{ marginTop: 12, maxWidth: 240 }}>
                  <Slider defaultValue={[40]} max={100} step={1} />
                </div>
              </div>
              <Row><Label2>Toggle</Label2>
                <Toggle defaultPressed aria-label="Bold"><b>B</b></Toggle>
                <Toggle aria-label="Italic"><i>I</i></Toggle>
                <ToggleGroup type="single" defaultValue="left">
                  <ToggleGroupItem value="left">Left</ToggleGroupItem>
                  <ToggleGroupItem value="center">Center</ToggleGroupItem>
                  <ToggleGroupItem value="right">Right</ToggleGroupItem>
                </ToggleGroup>
              </Row>
            </div>
          </div>
        </Section>

        <Section title="Card">
          <Card style={{ maxWidth: 380 }}>
            <CardHeader>
              <CardTitle>Convert your first design</CardTitle>
              <CardDescription>Paste a Figma frame and send it straight to WordPress.</CardDescription>
            </CardHeader>
            <CardBody>
              <p style={{ margin: 0, fontSize: 'var(--uc-text-base)', color: 'var(--uc-text)' }}>
                Cards read as a single raised surface on the flat canvas, hairline border, no heavy shadow.
              </p>
            </CardBody>
            <CardFooter>
              <Button variant="ghost" tone="neutral" size="sm">Learn more</Button>
              <Button tone="brand" size="sm">Get started</Button>
            </CardFooter>
          </Card>
        </Section>

        <Section title="Tabs">
          <Tabs defaultValue="resources" style={{ maxWidth: 460 }}>
            <TabsList>
              <TabsTrigger value="resources">Resources</TabsTrigger>
              <TabsTrigger value="faq">FAQ</TabsTrigger>
              <TabsTrigger value="changelog">Changelog</TabsTrigger>
            </TabsList>
            <TabsContent value="resources"><p style={{ color: 'var(--uc-text)' }}>Docs, videos and community links.</p></TabsContent>
            <TabsContent value="faq"><p style={{ color: 'var(--uc-text)' }}>Answers to common questions.</p></TabsContent>
            <TabsContent value="changelog"><p style={{ color: 'var(--uc-text)' }}>What shipped recently.</p></TabsContent>
          </Tabs>
        </Section>

        <Section title="Accordion">
          <Accordion type="single" collapsible style={{ maxWidth: 520 }}>
            <AccordionItem value="a">
              <AccordionTrigger>What is UiChemy?</AccordionTrigger>
              <AccordionContent>It converts Figma designs into WordPress builder elements.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="b">
              <AccordionTrigger>Which builders are supported?</AccordionTrigger>
              <AccordionContent>Elementor, Bricks and Gutenberg.</AccordionContent>
            </AccordionItem>
            <AccordionItem value="c">
              <AccordionTrigger>Do I need a license?</AccordionTrigger>
              <AccordionContent>Pro features work without one; a license adds updates and priority support.</AccordionContent>
            </AccordionItem>
          </Accordion>
        </Section>

        <Section title="Overlays">
          <Row style={{ gap: 12 }}>
            <Tooltip content="This is a tooltip">
              <Button variant="outline" tone="neutral">Hover for tooltip</Button>
            </Tooltip>

            <Popover>
              <PopoverTrigger asChild><Button variant="outline" tone="neutral">Open popover</Button></PopoverTrigger>
              <PopoverContent>
                <div style={{ padding: 4, maxWidth: 200 }}>
                  <p style={{ margin: 0, fontSize: 'var(--uc-text-sm)', color: 'var(--uc-text)' }}>A small floating panel anchored to its trigger.</p>
                </div>
              </PopoverContent>
            </Popover>

            <Menu>
              <MenuTrigger asChild><Button variant="outline" tone="neutral">Open menu</Button></MenuTrigger>
              <MenuContent align="start">
                <MenuLabel>Actions</MenuLabel>
                <MenuItem><Icon.ExtLink size={13} /> Open</MenuItem>
                <MenuItem><Icon.Gear size={13} /> Settings</MenuItem>
                <MenuSeparator />
                <MenuItem danger><Icon.LogOut size={13} /> Delete</MenuItem>
              </MenuContent>
            </Menu>

            <Dialog>
              <DialogTrigger asChild><Button tone="brand">Open dialog</Button></DialogTrigger>
              <DialogContent>
                <DialogCard>
                  <DialogHeader>
                    <DialogTitle>Disconnect this site?</DialogTitle>
                    <DialogDescription>You can reconnect any time from the dashboard.</DialogDescription>
                  </DialogHeader>
                  <DialogBody>
                    <p style={{ margin: 0, color: 'var(--uc-text)' }}>This removes the pairing between Figma and WordPress.</p>
                  </DialogBody>
                  <DialogFooter>
                    <Button variant="outline" tone="neutral">Cancel</Button>
                    <Button tone="danger">Disconnect</Button>
                  </DialogFooter>
                </DialogCard>
              </DialogContent>
            </Dialog>
          </Row>
        </Section>

        <Section title="Separator · Skeleton">
          <div style={colStyle}>
            <div style={{ maxWidth: 460 }}>
              <span style={{ color: 'var(--uc-text)' }}>Above</span>
              <Separator style={{ margin: '12px 0' }} />
              <span style={{ color: 'var(--uc-text)' }}>Below</span>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Skeleton style={{ width: 44, height: 44, borderRadius: '50%' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Skeleton style={{ width: 180, height: 12, borderRadius: 6 }} />
                <Skeleton style={{ width: 120, height: 12, borderRadius: 6 }} />
              </div>
            </div>
          </div>
        </Section>
      </div>
      </div>
    </TooltipProvider>
  );
}
