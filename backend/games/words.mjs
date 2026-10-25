/* Join codes are one common, classroom-safe English word. A code only has to be
   unique among games that are not completed (the Codes table enforces it), so a
   few hundred words is plenty; extend the list freely, lowercase letters only. */

export const WORDS = [...new Set(`
  acorn alpine amber anchor apple apricot arbor arctic aspen aster atlas aurora
  autumn azure badger bamboo banjo barley basil beacon beech berry birch bison
  bloom blossom bluff boulder bramble breeze brook buckeye buffalo cabin cactus
  calico camel canary candle canoe canyon caramel cardinal carrot cascade cashew
  castle cedar celery cello chalk channel chestnut chimney cider cinnamon citrus
  clover cobalt comet compass copper coral cotton coyote crane crater cricket
  crimson crystal cypress daisy delta desert dolphin dove dune eagle echo eclipse
  elder ember emerald falcon fern fiddle finch fjord flame flint forest fossil
  frost galaxy garnet gazelle geyser glacier globe granite grape gravel grove
  harbor harvest hawk hazel heather heron hickory horizon iris island ivory
  jade jasmine juniper kayak kelp kestrel kettle kiwi koala lagoon lantern larch
  lark laurel lava lemon lilac lily lime linden lotus lunar lynx magnet magpie
  mango maple marble marsh meadow mesa meteor midnight mint mist monarch moose
  mosaic moss mountain mustang nectar nebula nutmeg oasis ocean olive onyx opal
  orbit orchard orchid osprey otter oyster paddle palm panda papaya parrot peach
  pearl pebble pecan pelican pepper petal pigeon pine planet plum polar pollen
  poplar poppy prairie prism puffin pumpkin quail quartz quill rabbit raccoon
  radish raven reef ridge river robin rocket saffron sage salmon sapphire
  savanna scarlet sequoia shell sierra silver slate sparrow spruce squirrel
  stone summit sunset swan sycamore thistle thunder tiger timber topaz tulip
  tundra turtle twilight valley velvet violet volcano walnut walrus willow
  winter wolf wren yarrow zebra zephyr
  northern southern eastern western coastal highland lowland upland inlet cove
  cape plateau lakeside riverbank seaside hilltop
  anvil arrow banner barrel basket bell bicycle blanket bridge bucket button
  cable camera canvas carpet chess clock cloud cradle crown drum easel engine
  feather fountain garden gate guitar hammer helmet jigsaw kite ladder lamp
  locket mirror mitten needle notebook palette parade pencil piano pillow
  pocket puzzle quilt radio ribbon saddle sail satchel scroll shovel signal
  sketch sled spindle spoon stamp statue teapot telescope thimble ticket
  toolbox torch trumpet tunnel umbrella violin wagon whistle window yarn
  accord anthem ballad cadence canopy chorus civic council harmony legacy
  liberty meridian nimbus odyssey pioneer quest rhythm tempo voyage treaty
  almond bagel biscuit brioche cocoa cookie crumble custard dumpling granola
  hazelnut lentil noodle oatmeal pancake pastry pretzel quinoa raisin sesame
  sorbet toffee truffle waffle yogurt
  albatross antelope beetle bobcat caribou chipmunk condor dragonfly egret
  ferret flamingo gecko gopher hedgehog ibis iguana jaguar jackal lemur llama
  manatee marmot meerkat narwhal ocelot opossum pheasant platypus porcupine
  reindeer salamander seahorse starling stork tapir toucan wombat
  breakwater driftwood firefly lighthouse moonbeam rainbow sandstone seashell
  snowflake starlight sunbeam waterfall whirlwind windmill
`.split(/\s+/).filter(Boolean))];

export function randomWord(rand = Math.random) {
  return WORDS[Math.floor(rand() * WORDS.length)];
}
