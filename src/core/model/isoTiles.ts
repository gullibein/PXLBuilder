/**
 * Isometric blocks (16 × 16 pixel art, 2:1: a top 16 wide and 8 high, sides 8 high), drawn by the user for the
 * Isometric starter: water and its shores, grass, dirt, ice, cobblestone, wood, snow, magma, lava, grassy dirt, dark
 * and light stone. Each palette is "key color" pairs; "." is see-through.
 */
import type { PixelArt } from './pixelArt';

const tile = (palette: string, rows: string[]): PixelArt => ({ palette: palette.split(' ').map((p) => ({ key: p[0], color: p.slice(1) })), rows });

export const ISO_TILES: Record<string, PixelArt> = {
  'Water': tile(
    'a#19000b b#190819 c#2ce8f4 d#140d20 e#ffffff f#0099dc g#0095db h#160000 i#18001b j#124e8a k#103e81 l#009ee3 m#181425',
    ['.......aa.......', '.....bbccab.....', '...ddccceecdd...', '.bbccecfcccgchi.', 'bccgececcccegccb', 'bfgccccgeccecged', 'bccffceccecgeccb', 'bjjccgeccgeccgfd', 'bjjjjccgeccffffb', 'bjjjjkkccggfjjfb', 'bjjffjjjffjjlffb', 'blljjffjjjfffjjb', '.aalljjjlffjjab.', '...bblfjljjbd...', '.....bbljbb.....', '.......dm.......'],
  ),
  'Water Shore 1': tile(
    'a#190819 b#63c74d c#19000b d#2ce8f4 e#ffffff f#140d20 g#0099dc h#0095db i#160000 j#18001b k#3e8948 l#193c3e m#265c42 n#124e8a o#009ee3 p#1b0000',
    ['.......aa.......', '.....aabbca.....', '...aabbdeddff...', '.aabbbdgdedhdij.', 'abbkbdedddedhdda', 'abbbbddhededdhef', 'akkbbdeddedhedda', 'alklkkeddheddhgf', 'alllklkkeddgggga', 'ammlllkddhhgnnga', 'allmmlknggnnogga', 'allllllnnngggnna', '.aalllmnoggnnca.', '...pallnonnaf...', '.....aaonaa.....', '.......aa.......'],
  ),
  'Water Shore 2': tile(
    'a#190819 b#3e8948 c#63c74d d#211d19 e#2ce8f4 f#0099dc g#ffffff h#00171c i#0095db j#140d20 k#124e8a l#103e81 m#009ee3 n#19000b o#181425',
    ['.......aa.......', '.....aabcaa.....', '...aabcccccdd...', '.aacccefegccchd.', 'accigegeeegeicca', 'acieeeeigegeeigj', 'aeeffegeegeigeea', 'akkeeigeeigeeifj', 'akkkkeeigeeffffa', 'akkkklleeiifkkfa', 'akkffkkkffkkmffa', 'ammkkffkkkfffkka', '.nnmmkkkmffkkna.', '...aamfkmkkaj...', '.....aamkaa.....', '.......jo.......'],
  ),
  'Water Shore 3': tile(
    'a#19000b b#190819 c#2ce8f4 d#140d20 e#ffffff f#211d19 g#151515 h#0099dc i#0095db j#00171c k#63c74d l#3e8948 m#193c3e n#265c42 o#408f46 p#1b0000',
    ['.......aa.......', '.....bbccab.....', '...ddccceccdd...', '.fgcccehcecicjf.', 'bkciecccccccickb', 'bllcceciecceckkb', 'bmlllcceccellnlb', 'bmlmlllkkllnlnnb', 'bmmmlmlllnlnnnnb', 'bnnmmmlmonnnnnnb', 'bmmnnmlmnnnnnnnb', 'bmmmmmmnnnmmnnnb', '.bbmmmnnmmnnnbb.', '...pbmmmnnnbb...', '.....bbmnbb.....', '.......bb.......'],
  ),
  'Water Shore 4': tile(
    'a#231912 b#190819 c#63c74d d#3e8948 e#151515 f#140d20 g#2ce8f4 h#211d19 i#ffffff j#0099dc k#00171c l#0095db m#124e8a n#265c42 o#103e81 p#193c3e q#408f46 r#009ee3 s#19000b t#1b0000',
    ['.......aa.......', '.....bbcdea.....', '...ffggggcdhh...', '.bbggiijiggcdkh.', 'bgglgggggigiccdb', 'bjliigglgggiccdb', 'bggjjgiggicccddb', 'bmmgglgigccndnnb', 'bmmmmggddndnnnnb', 'bmmmmoopqnnnnnnb', 'bmmjjmmpnnnnnnnb', 'brrmmjjnnnppnnnb', '.ssrrmmnppnnnbb.', '...bbrjpnnnbt...', '.....bbpnbb.....', '.......bb.......'],
  ),
  'Grass': tile(
    'a#231912 b#1b0000 c#3e8948 d#63c74d e#20151e f#211d19 g#265c42 h#190819 i#1e493e j#193c3e k#408f46',
    ['.......ab.......', '.....aacdea.....', '...bfcdddcdfa...', '.fecddddgcdddhe.', 'hcddddcdddddcddh', 'hccddicddddiccch', 'hjccdddddddccgch', 'hjcjcccddccgcggh', 'hjjjcjcccgcggggh', 'hggjjjcjkggggggh', 'hjjggjcjgggggggh', 'hjjjjjjgggjjgggh', '.hhjjjggjjggghh.', '...hhjjjggghb...', '.....hhjghh.....', '.......hh.......'],
  ),
  'Dirt': tile(
    'a#190819 b#b86f4f c#00171c d#733e3a e#3e2731',
    ['.......aa.......', '.....aabbaa.....', '...aabbbbbbaa...', '.aabbbbbbbbbbca.', 'abbbbddebbbebbba', 'abebbeebbbbbbbba', 'aeebbbbbbbbbbdda', 'aeeeebbbbbbdddda', 'aeeeeeebbdddddda', 'aeeeeeeedeedddda', 'aeeeddeeedddddda', 'aeeeeeddddddddda', '.aaeeeeedddddaa.', '...aaeeedddaa...', '.....aaedaa.....', '.......aa.......'],
  ),
  'Ice': tile(
    'a#19000b b#190000 c#140d20 d#ffffff e#000000 f#190819 g#2ce8f4 h#18001b i#00001d j#000018 k#0099dc l#0095db m#009ee3 n#124e8a o#1b0000',
    ['.......ab.......', '.....bcddef.....', '...ccggddddcf...', '.ahggddddddddij.', 'fggdddddddddgddc', 'fdddddddddgggddc', 'akkdddddgggddldc', 'amkggddggddkkldc', 'anngggkddlkllddc', 'annllgkldlkddddc', 'annkklnldddddddc', 'ammkkknndddddldf', '.afgglnndddmmff.', '...aagkndllfo...', '.....ahkdef.....', '.......ca.......'],
  ),
  'Cobblestone': tile(
    'a#19000b b#190000 c#1b0000 d#190819 e#8b9bb4 f#140d20 g#181425 h#c0ccdc i#3a4467 j#5a6988 k#607090 l#c9d6e6 m#4a5c7f',
    ['.......ab.......', '.....cdeedd.....', '...fgheeehefd...', '.afeeeeheeeheff.', 'aeeehheeeeeeheef', 'aeheeeeheeheeehf', 'aiieheeeeeeehjjg', 'akjiieheheejjehf', 'aiijjiieljjeljjg', 'aiiiijjimehjjjjg', 'akjiiiijljjjjehf', 'ciijjiiijjjehjjd', '.bdiijjijehjkdd.', '...ffiijljjfd...', '.....dgijfg.....', '.......fa.......'],
  ),
  'Wood': tile(
    'a#19000b b#190000 c#190819 d#ebd7ac e#140d20 f#000020 g#e6a874 h#b86f4f i#00000c j#000018 k#00001d l#733e3a m#001224 n#181425 o#16172b',
    ['.......ab.......', '.....ccddcc.....', '...efgghhddfc...', '.ifhhddgghhddff.', 'jddgghhddgghhddk', 'khhddgghhddgghhe', 'ellhhddgghhddhhe', 'ellllhhddgghhhhe', 'ellllllhhhhhhhhe', 'elllllllghhhhhhe', 'elllllllghhhhhhe', 'elllllllghhhhhhj', '.bclllllghhhhcc.', '...emlllghhkj...', '.....nnlgoo.....', '.......ec.......'],
  ),
  'Dark Grass': tile(
    'a#231912 b#1b0000 c#3e8948 d#63c74d e#20151e f#211d19 g#190819 h#265c42 i#1e493e j#193c3e k#408f46 l#1f1d23',
    ['.......ab.......', '.....aacdea.....', '...bfcdddddfa...', '.fecddddddcddge.', 'fcdddcddchcddddf', 'fccdicdhcddddccf', 'fjcccddddddcchcf', 'fjcjcccddcchchhf', 'fjjjcjccchchhhhf', 'fhhjjjcjkhhhhhhf', 'fjjhhjcjhhhhhhhf', 'fjjjjjjhhhjjhhha', '.afjjjhhjjhhhaa.', '...bajjjhhhab...', '.....ffjhlf.....', '.......fa.......'],
  ),
  'Dark Dirt': tile(
    'a#231912 b#b86f4f c#190819 d#211d19 e#733e3a f#151515 g#00171c h#3e2731',
    ['.......aa.......', '.....aabbcc.....', '...ddbbbebbcc...', '.dfbbbbbbbbbbgc.', 'abbebbehbbbbbbbc', 'abbbbbbbbbehbbbc', 'ahhbbebbbbbbbeec', 'ahhhhbbbbbbeeeec', 'ahhhhhhbbeeeeeec', 'ahhhhhhhehheeeec', 'ahhheehhheeeeeec', 'ahhhhheeeeeeeeec', '.cchhhhheeeeecc.', '...cchhheeecc...', '.....cchecc.....', '.......cc.......'],
  ),
  'Snow': tile(
    'a#19000b b#190000 c#190819 d#ffffff e#000000 f#140d20 g#c0ccdc h#000013 i#000018 j#8b9bb4 k#5a6988 l#c9d6e6 m#18001b n#4a5c7f o#0c0000',
    ['.......ab.......', '.....acddec.....', '...ffddggddfa...', '.hhddggddggddif.', 'cddggggggddggddf', 'cddggddggggddddf', 'ajkddggddggddgdf', 'ajkkkddggddjjgdf', 'ajkkkjkddjgjjgdf', 'ajkkkjkkdjgjjgdf', 'ajkkkjkkdjgjjgdf', 'aglkkjkkdjgjjddf', '.amggjkkdjgddcc.', '...ccllndddab...', '.....ohgdeh.....', '.......fc.......'],
  ),
  'Magma': tile(
    'a#19000b b#190000 c#190819 d#c0ccdc e#c9d6e6 f#140d20 g#e53b44 h#e62e35 i#4a5c7f j#3a4467 k#feae35 l#00001d m#001224 n#5a6988 o#ffb635 p#16172b q#8b9bb4 r#154071 s#a42634 t#181425 u#16304b v#f77622 w#002342 x#990030 y#94a6c0 z#ffed64 A#fee763 B#fff566 C#00000c D#000023',
    ['.......ab.......', '.....bcdecc.....', '...ffggghddca...', '.cfdijhkggggglm.', 'ahdnnnjghenjgogp', 'aeqeinjgennnnrqf', 'akgddjgoghnnjsst', 'agugggenjhddqgst', 'auksgggejdqggoqf', 'avkvwwggghgdxvkf', 'akkkxowggygqkvvp', 'bzAkvkksvoxkkzzf', '.aczzkkkvvkzzcc.', '...aaBzkkzzab...', '.....CDAzDD.....', '.......fc.......'],
  ),
  'Lava': tile(
    'a#190000 b#190819 c#ffed64 d#a42634 e#140d20 f#00001d g#fff566 h#31132e i#3e2731 j#b12937 k#000020 l#feae35 m#181425 n#001224 o#990030 p#ffb635 q#000023 r#fee763 s#12002b t#2e0f2f u#f77622 v#e53b44 w#16172b x#1b0000 y#19000b z#00000c A#18001b',
    ['.......aa.......', '.....bbcdbb.....', '...efghicjieb...', '.bklcddihlccdmi.', 'ndldhgohcdiipdhm', 'qprddspctpdihlck', 'kuvllgoddhlccvuw', 'qpuculcdhllvuclk', 'kclluvvlluuullrq', 'kclllcuvuulcllrq', 'kcclcluulcluclrq', 'fcrrrclulrccrcrk', '.xbccrrulrrccbb.', '...yzccrrccyx...', '.....qqrcqq.....', '.......AA.......'],
  ),
  'Grassy Dirt': tile(
    'a#190819 b#3e8948 c#63c74d d#b86f4f e#733e3a f#3e2731',
    ['.......aa.......', '.....aabcaa.....', '...aabcccccaa...', '.aacccddddcccaa.', 'acceddddefdddcca', 'acddddddddddddda', 'affddfdddeeddeea', 'affffddddddeeeea', 'affffffddeeeeeea', 'afffffffeffeeeea', 'afffeefffeeeeeea', 'afffffeeeeeeeeea', '.aafffffeeeeeaa.', '...aafffeeeaa...', '.....aafeaa.....', '.......aa.......'],
  ),
  'Grassy Dirt 2': tile(
    'a#190819 b#231912 c#63c74d d#211d19 e#b86f4f f#151515 g#3e2731 h#3e8948 i#733e3a j#643834 k#193c3e l#265c42 m#1b0000',
    ['.......aa.......', '.....bbccaa.....', '...ddcceeeeaa...', '.dfccceeeegeeaa.', 'acchcieeeeeeeeea', 'acccceeeejgeeeea', 'ahhcciieeeeeeiia', 'akhkhheeeeeiiiia', 'akkkhkhheiiiiiia', 'allkkkhgiggiiiia', 'akkllkhggiiiiiia', 'akkkkkkiiiiiiiia', '.aakkklgiiiiiaa.', '...makkgiiiaa...', '.....aagiaa.....', '.......aa.......'],
  ),
  'Grassy Dirt 3': tile(
    'a#231912 b#b86f4f c#151515 d#211d19 e#190819 f#733e3a g#00171c h#63c74d i#3e8948 j#3e2731 k#193c3e l#265c42 m#408f46 n#1b0000',
    ['.......aa.......', '.....aabbca.....', '...ddbbbbbbdd...', '.eebbfbbffbbbgd.', 'ehbbbbbbbbbbfbhe', 'eiibffjbbbbbbhhe', 'ekiiibbbbfbiilie', 'ekikiiihhiilille', 'ekkkikiiililllle', 'ellkkkikmlllllle', 'ekkllkikllllllle', 'ekkkkkklllkkllle', '.eekkkllkklllee.', '...nekkklllee...', '.....eeklee.....', '.......ee.......'],
  ),
  'Grassy Dirt 4': tile(
    'a#190819 b#231912 c#63c74d d#3e8948 e#211d19 f#b86f4f g#733e3a h#151515 i#00171c j#3e2731 k#643834 l#265c42 m#193c3e n#408f46 o#1b0000',
    ['.......aa.......', '.....bbcdaa.....', '...eefffgcdaa...', '.ehffffffffcdia.', 'affffggjffffccda', 'agffggjffkgjccda', 'ajjfffffffcccdda', 'ajjjjffffccldlla', 'ajjjjjjddldlllla', 'ajjjjjjmnlllllla', 'ajjjggjmllllllla', 'ajjjjjglllmmllla', '.aajjjjlmmlllaa.', '...aajjmlllao...', '.....aamlaa.....', '.......aa.......'],
  ),
  'Dark Stone': tile(
    'a#0c0000 b#595959 c#5c5c5c d#000000 e#434343 f#262626 g#404040 h#2c2c2c i#303030 j#484848',
    ['.......aa.......', '.....aabcaa.....', '...adbbefbbda...', '.ddcbbbbbbbccdd.', 'abbbgehcbeefbbba', 'abbbbeefbehbbbba', 'ahhcbbbbbbbbbgea', 'ahhhhbbefbbeeeea', 'ahhhhhhcceeeeeea', 'ahhhhhhheehheeea', 'ahhhheehhheeeeea', 'ahhhhhheeeeeeeea', '.aaihhhheeeejda.', '...adhheeeedd...', '.....adhjda.....', '.......da.......'],
  ),
  'Light Stone': tile(
    'a#190819 b#1b0000 c#c0ccdc d#c9d6e6 e#160000 f#140d20 g#000013 h#000000 i#4a5c7f j#8b9bb4 k#5a6988 l#190000 m#19000b n#607090 o#94a6c0 p#0c0000',
    ['.......ab.......', '.....aacdaa.....', '...efccccccfe...', '.ghdijjcdkjjdhg.', 'lddccccccccccddl', 'acccccccccccccca', 'akkdcccccccccjja', 'akkkkckjjccjjjja', 'akkkkkkccjjjjjja', 'akkkkkkkjjjjjjja', 'akkkkkkkjjjjjjja', 'mkkkkkkkjjjjjjja', '.mmnkkkkjjjjoea.', '...efkkkjjjfp...', '.....afkofa.....', '.......fb.......'],
  ),
};
