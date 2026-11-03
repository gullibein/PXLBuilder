/**
 * Isometric blocks (16 × 16 pixel art, 2:1: a top 16 wide and 8 high, sides 8 high), drawn by the user for the
 * Isometric starter: water and its corners (land on that corner: for lakes), grass, dirt, ice, cobblestone, wood,
 * snow, magma, light and dark stone, four road turns, and the island's four corners (grass meeting the water). Each palette is "key color" pairs; "." is see-through.
 */
import type { PixelArt } from './pixelArt';

const tile = (palette: string, rows: string[]): PixelArt => ({ palette: palette.split(' ').map((p) => ({ key: p[0], color: p.slice(1) })), rows });

export const ISO_TILES: Record<string, PixelArt> = {
  'Water': tile(
    'a#19000b b#190819 c#2ce8f4 d#140d20 e#ffffff f#0099dc g#0095db h#160000 i#18001b j#124e8a k#103e81 l#009ee3 m#181425',
    ['.......aa.......', '.....bbccab.....', '...ddccceecdd...', '.bbccecfcccgchi.', 'bccgececcccegccb', 'bfgccccgeccecged', 'bccffceccecgeccb', 'bjjccgeccgeccgfd', 'bjjjjccgeccffffb', 'bjjjjkkccggfjjfb', 'bjjffjjjffjjlffb', 'blljjffjjjfffjjb', '.aalljjjlffjjab.', '...bblfjljjbd...', '.....bbljbb.....', '.......dm.......'],
  ),
  'Water Corner West': tile(
    'a#190819 b#63c74d c#19000b d#2ce8f4 e#ffffff f#140d20 g#0099dc h#0095db i#160000 j#18001b k#3e8948 l#193c3e m#265c42 n#124e8a o#009ee3 p#1b0000',
    ['.......aa.......', '.....aabbca.....', '...aabbdeddff...', '.aabbbdgdedhdij.', 'abbkbdedddedhdda', 'abbbbddhededdhef', 'akkbbbeddedhedda', 'alklkkbbdheddhgf', 'alllklkkbddgggga', 'ammlllkbdhhgnnga', 'allmmlknggnnogga', 'allllllnnngggnna', '.aalllmnoggnnca.', '...pallnonnaf...', '.....aaonaa.....', '.......aa.......'],
  ),
  'Water Corner North': tile(
    'a#190819 b#3e8948 c#63c74d d#211d19 e#2ce8f4 f#0099dc g#ffffff h#00171c i#0095db j#140d20 k#124e8a l#103e81 m#009ee3 n#19000b o#181425',
    ['.......aa.......', '.....aabcaa.....', '...aabcccccdd...', '.aacccefegccchd.', 'accigegeeegeicca', 'acieeeeigegeeigj', 'aeeffegeegeigeea', 'akkeeigeeigeeifj', 'akkkkeeigeeffffa', 'akkkklleeiifkkfa', 'akkffkkkffkkmffa', 'ammkkffkkkfffkka', '.nnmmkkkmffkkna.', '...aamfkmkkaj...', '.....aamkaa.....', '.......jo.......'],
  ),
  'Water Corner South': tile(
    'a#19000b b#190819 c#2ce8f4 d#140d20 e#ffffff f#211d19 g#151515 h#0099dc i#0095db j#00171c k#63c74d l#3e8948 m#193c3e n#265c42 o#408f46 p#1b0000',
    ['.......aa.......', '.....bbccab.....', '...ddccceccdd...', '.fgcccehcecicjf.', 'bkkiecccccccickb', 'bllkkeciecckkkkb', 'bmlllkkkkkkllnlb', 'bmlmlllkkllnlnnb', 'bmmmlmlllnlnnnnb', 'bnnmmmlmonnnnnnb', 'bmmnnmlmnnnnnnnb', 'bmmmmmmnnnmmnnnb', '.bbmmmnnmmnnnbb.', '...pbmmmnnnbb...', '.....bbmnbb.....', '.......bb.......'],
  ),
  'Water Corner East': tile(
    'a#231912 b#190819 c#63c74d d#3e8948 e#151515 f#140d20 g#2ce8f4 h#211d19 i#ffffff j#0099dc k#00171c l#0095db m#124e8a n#265c42 o#103e81 p#193c3e q#408f46 r#009ee3 s#19000b t#1b0000',
    ['.......aa.......', '.....bbcdea.....', '...ffggggcdhh...', '.bbggiijigccdkh.', 'bgglgggggigcccdb', 'bjliigglgggcccdb', 'bggjjgiggicccddb', 'bmmgglgicccndnnb', 'bmmmmggddndnnnnb', 'bmmmmoopqnnnnnnb', 'bmmjjmmpnnnnnnnb', 'brrmmjjnnnppnnnb', '.ssrrmmnppnnnbb.', '...bbrjpnnnbt...', '.....bbpnbb.....', '.......bb.......'],
  ),
  'Island Corner North': tile(
    'a#19000b b#190819 c#2ce8f4 d#140d20 e#ffffff f#63c74d g#0095db h#160000 i#18001b j#3e8948 k#1e493e l#193c3e m#265c42 n#408f46 o#1b0000',
    ['.......aa.......', '.....bbccab.....', '...ddccceecdd...', '.bbfffffffcgchi.', 'bfffffjfffffjccb', 'bfjffkjffffkjjcb', 'bljjfffffffjjmjb', 'bljljjjffjjmjmmb', 'bllljljjjmjmmmmb', 'bmmllljlnmmmmmmb', 'bllmmljlmmmmmmmb', 'bllllllmmmllmmmb', '.bblllmmllmmmbb.', '...bblllmmmbo...', '.....bblmbb.....', '.......bb.......'],
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
  'Island Corner West': tile(
    'a#19000b b#190819 c#2ce8f4 d#140d20 e#63c74d f#160000 g#18001b h#3e8948 i#1e493e j#193c3e k#265c42 l#408f46 m#1b0000',
    ['.......aa.......', '.....bbccab.....', '...ddccccccdd...', '.bbcceeeeeeeefg.', 'bcceeeheeeeehehb', 'bcheeiheeeeihhhb', 'bjhheeeeeeehhkhb', 'bjhjhhheehhkhkkb', 'bjjjhjhhhkhkkkkb', 'bkkjjjhjlkkkkkkb', 'bjjkkjhjkkkkkkkb', 'bjjjjjjkkkjjkkkb', '.bbjjjkkjjkkkbb.', '...bbjjjkkkbm...', '.....bbjkbb.....', '.......bb.......'],
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
  'Light Stone': tile(
    'a#190819 b#1b0000 c#c0ccdc d#c9d6e6 e#160000 f#140d20 g#000013 h#000000 i#4a5c7f j#8b9bb4 k#5a6988 l#190000 m#19000b n#607090 o#94a6c0 p#0c0000',
    ['.......ab.......', '.....aacdaa.....', '...efccccccfe...', '.ghdijjcdkjjdhg.', 'lddccccccccccddl', 'acccccccccccccca', 'akkdcccccccccjja', 'akkkkckjjccjjjja', 'akkkkkkccjjjjjja', 'akkkkkkkjjjjjjja', 'akkkkkkkjjjjjjja', 'mkkkkkkkjjjjjjja', '.mmnkkkkjjjjoea.', '...efkkkjjjfp...', '.....afkofa.....', '.......fb.......'],
  ),
  'Island Corner South': tile(
    'a#231912 b#1b0000 c#3e8948 d#63c74d e#20151e f#211d19 g#265c42 h#190819 i#0099dc j#2ce8f4 k#1e493e l#ffffff m#124e8a n#0095db o#140d20 p#103e81 q#009ee3 r#19000b s#181425',
    ['.......ab.......', '.....aacdea.....', '...bfcdddcdfa...', '.fedddddgcdddhe.', 'hijdddcdddddcddh', 'hiijjddddddkccch', 'hjjiijlddddddddh', 'hmmjjnljjnnddddo', 'hmmmmjjnljjiiiih', 'hmmmmppjjnnimmih', 'hmmiimmmiimmqiih', 'hqqmmiimmmiiimmh', '.rrqqmmmqiimmrh.', '...hhqimqmmho...', '.....hhqmhh.....', '.......os.......'],
  ),
  'Road Turn SE-SW': tile(
    'a#190819 b#3e8948 c#63c74d d#b86f4f e#733e3a f#3e2731',
    ['.......aa.......', '.....aabcaa.....', '...aabcccccaa...', '.aacccddddcccaa.', 'addeddddefdddcca', 'aeddddddddddddda', 'affddfdddeeddeea', 'affffddddddeeeea', 'affffffddeeeeeea', 'afffffffeffeeeea', 'afffeefffeeeeeea', 'afffffeeeeeeeeea', '.aafffffeeeeeaa.', '...aafffeeeaa...', '.....aafeaa.....', '.......aa.......'],
  ),
  'Road Turn SE-NE': tile(
    'a#190819 b#231912 c#63c74d d#b86f4f e#211d19 f#151515 g#3e2731 h#3e8948 i#643834 j#733e3a k#193c3e l#265c42 m#1b0000',
    ['.......aa.......', '.....bbcdaa.....', '...eeccddddaa...', '.efcccddddgddaa.', 'acchccddddddddda', 'acccccdddigdddda', 'ahhccccddddddjja', 'akhkhhcddddjjjja', 'akkkhkhhdjjjjjja', 'allkkkhgjggjjjja', 'akkllkhggjjjjjja', 'akkkkkkjjjjjjjja', '.aakkklgjjjjjaa.', '...makkgjjjaa...', '.....aagjaa.....', '.......aa.......'],
  ),
  'Road Turn NW-NE': tile(
    'a#231912 b#b86f4f c#151515 d#211d19 e#190819 f#733e3a g#00171c h#63c74d i#3e8948 j#3e2731 k#193c3e l#265c42 m#408f46 n#1b0000',
    ['.......aa.......', '.....aabbca.....', '...ddbbbbbbdd...', '.eebbfbbffbbbgd.', 'ehbbbbbbbbbbfbhe', 'eihhhfjbbbbhhhhe', 'ekiiihhhhhhiilie', 'ekikiiihhiilille', 'ekkkikiiililllle', 'ellkkkikmlllllle', 'ekkllkikllllllle', 'ekkkkkklllkkllle', '.eekkkllkklllee.', '...nekkklllee...', '.....eeklee.....', '.......ee.......'],
  ),
  'Road Turn NW-SW': tile(
    'a#190819 b#231912 c#63c74d d#3e8948 e#211d19 f#b86f4f g#733e3a h#151515 i#00171c j#3e2731 k#643834 l#265c42 m#193c3e n#408f46 o#1b0000',
    ['.......aa.......', '.....bbcdaa.....', '...eefffgcdaa...', '.ehfffffffccdia.', 'affffggjfffcccda', 'agffggjffkgcccda', 'ajjfffffffcccdda', 'ajjjjffffccldlla', 'ajjjjjjddldlllla', 'ajjjjjjmnlllllla', 'ajjjggjmllllllla', 'ajjjjjglllmmllla', '.aajjjjlmmlllaa.', '...aajjmlllao...', '.....aamlaa.....', '.......aa.......'],
  ),
  'Dark Stone': tile(
    'a#0c0000 b#595959 c#5c5c5c d#000000 e#434343 f#262626 g#404040 h#2c2c2c i#303030 j#484848',
    ['.......aa.......', '.....aabcaa.....', '...adbbefbbda...', '.ddcbbbbbbbccdd.', 'abbbgehcbeefbbba', 'abbbbeefbehbbbba', 'ahhcbbbbbbbbbgea', 'ahhhhbbefbbeeeea', 'ahhhhhhcceeeeeea', 'ahhhhhhheehheeea', 'ahhhheehhheeeeea', 'ahhhhhheeeeeeeea', '.aaihhhheeeejda.', '...adhheeeedd...', '.....adhjda.....', '.......da.......'],
  ),
  'Island Corner East': tile(
    'a#231912 b#1b0000 c#3e8948 d#63c74d e#20151e f#211d19 g#265c42 h#190819 i#2ce8f4 j#0095db k#ffffff l#140d20 m#0099dc n#124e8a o#103e81 p#009ee3 q#19000b r#181425',
    ['.......ab.......', '.....aacdea.....', '...bfcdddcdfa...', '.fecddddgcdddhe.', 'hcddddcddddicjjh', 'hddddddjkiikijkl', 'hiimmikiikijkiih', 'hnniijkiijkiijml', 'hnnnniijkiimmmmh', 'hnnnnooiijjmnnmh', 'hnnmmnnnmmnnpmmh', 'hppnnmmnnnmmmnnh', '.qqppnnnpmmnnqh.', '...hhpmnpnnhl...', '.....hhpnhh.....', '.......lr.......'],
  ),
};
