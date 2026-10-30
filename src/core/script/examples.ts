/**
 * Example scripts shown to the AI. Tests check that each one passes the
 * checker and behaves as described in play, so the AI never learns from a
 * broken example.
 */
export const SCRIPT_EXAMPLES: { title: string; json: string }[] = [
  {
    title: 'an enemy that walks, charges when the player is near, then rests',
    json: `{"name":"Charger","description":"Walks back and forth; charges when the player is within 5 tiles, then rests for a second.","vars":[{"name":"walk_speed","value":50},{"name":"charge_speed","value":220},{"name":"range","value":160}],"states":["walk","charge","rest"],"handlers":[
 {"when":{"on":"tick"},"state":"walk","if":null,"do":[{"do":"if","cond":"solid_at(self.x + self.facing * (self.width / 2 + 2), self.y) or not solid_at(self.x + self.facing * (self.width / 2 + 2), self.y + self.height / 2 + 4)","then":[{"do":"face","dir":"-self.facing"}],"else":[]},{"do":"velocity","x":"self.facing * walk_speed","y":null}]},
 {"when":{"on":"tick"},"state":"walk","if":"dist(player) < range and can_see(player)","do":[{"do":"face","dir":"sign(dx(player))"},{"do":"state","name":"charge"}]},
 {"when":{"on":"tick"},"state":"charge","if":null,"do":[{"do":"velocity","x":"self.facing * charge_speed","y":null}]},
 {"when":{"on":"tick"},"state":"charge","if":"state_time > 1.2 or solid_at(self.x + self.facing * (self.width / 2 + 2), self.y)","do":[{"do":"state","name":"rest"}]},
 {"when":{"on":"enter_state"},"state":"rest","if":null,"do":[{"do":"velocity","x":"0","y":null}]},
 {"when":{"on":"tick"},"state":"rest","if":"state_time > 1","do":[{"do":"state","name":"walk"}]}]}`,
  },
  {
    title: 'the player gets a jetpack with limited fuel shown on screen',
    json: `{"name":"Jetpack","description":"Hold Up to fly while fuel lasts; fuel refills on the ground.","vars":[{"name":"fuel","value":100}],"states":[],"handlers":[
 {"when":{"on":"key","key":"up","edge":"held"},"state":null,"if":"fuel > 0","do":[{"do":"velocity","x":null,"y":"max(self.vy - 1500 * dt, -220)"},{"do":"set","var":"fuel","value":"fuel - 60 * dt"}]},
 {"when":{"on":"tick"},"state":null,"if":"self.grounded and fuel < 100","do":[{"do":"set","var":"fuel","value":"min(100, fuel + 80 * dt)"}]},
 {"when":{"on":"every","seconds":0.5},"state":null,"if":"fuel < 100","do":[{"do":"message","text":"Fuel {round(fuel)}%","seconds":0.6}]}]}`,
  },
  {
    title: 'a platform that crumbles shortly after the player steps on it and comes back',
    json: `{"name":"Crumble","description":"Falls apart 0.6 s after the player lands on it; returns after 3 s.","vars":[],"states":["solid","shaking","gone"],"handlers":[
 {"when":{"on":"event","event":"touch_started","with":"player"},"state":"solid","if":null,"do":[{"do":"state","name":"shaking"}]},
 {"when":{"on":"tick"},"state":"shaking","if":null,"do":[{"do":"position","x":"self.spawn_x + sin(time * 60) * 1.5","y":"self.y"}]},
 {"when":{"on":"tick"},"state":"shaking","if":"state_time > 0.6","do":[{"do":"set_open","target":"self","open":"true"},{"do":"alpha","value":"0"},{"do":"state","name":"gone"}]},
 {"when":{"on":"tick"},"state":"gone","if":"state_time > 3","do":[{"do":"position","x":"self.spawn_x","y":"self.y"},{"do":"set_open","target":"self","open":"false"},{"do":"alpha","value":"1"},{"do":"state","name":"solid"}]}]}`,
  },
  {
    title: 'water (tag it "water"): the player moves slowly and sinks gently in it, and is back to normal when out of all water',
    json: `{"name":"Water","description":"The player moves at 45% speed and sinks slowly while in the water.","vars":[{"name":"slow","value":0.45},{"name":"sink","value":0.25},{"name":"max_sink","value":60}],"states":[],"handlers":[
 {"when":{"on":"event","event":"touch_started","with":"player"},"state":null,"if":null,"do":[{"do":"speed_factor","value":"slow","on":"other"},{"do":"gravity","scale":"sink","on":"other"},{"do":"velocity","x":null,"y":"min(other.vy, max_sink)","on":"other"}]},
 {"when":{"on":"tick"},"state":null,"if":null,"do":[{"do":"each","tag":"player","then":[{"do":"if","cond":"overlaps(it) and it.vy > max_sink","then":[{"do":"velocity","x":null,"y":"max_sink","on":"it"}],"else":[]}]}]},
 {"when":{"on":"event","event":"touch_ended","with":"player"},"state":null,"if":"not touching('water', other)","do":[{"do":"speed_factor","value":"1","on":"other"},{"do":"gravity","scale":"1","on":"other"}]}]}`,
  },
  {
    title: 'the player swims: Jump in water makes a stroke upward (works with the Water example)',
    json: `{"name":"Swim","description":"Pressing Jump while in water pushes the player up.","vars":[{"name":"stroke","value":160}],"states":[],"handlers":[
 {"when":{"on":"key","key":"jump","edge":"pressed"},"state":null,"if":"touching('water')","do":[{"do":"velocity","x":null,"y":"-stroke"}]}]}`,
  },
  {
    title: 'a pause menu (put it on the player): Esc / P / Start opens it; Up/Down choose, Jump picks; Resume, Sound on/off, Music on/off, Restart',
    json: `{"name":"Pause menu","description":"Esc pauses the game and shows a menu: Resume, Sound, Music, Restart.","vars":[{"name":"choice","value":0},{"name":"shown","value":false}],"states":[],"handlers":[
 {"when":{"on":"key","key":"menu","edge":"pressed"},"state":null,"if":null,"do":[{"do":"if","cond":"paused","then":[{"do":"resume"}],"else":[{"do":"set","var":"choice","value":"0"},{"do":"pause"}]}]},
 {"when":{"on":"key","key":"up","edge":"pressed"},"state":null,"if":"paused","do":[{"do":"set","var":"choice","value":"(choice + 3) % 4"}]},
 {"when":{"on":"key","key":"down","edge":"pressed"},"state":null,"if":"paused","do":[{"do":"set","var":"choice","value":"(choice + 1) % 4"}]},
 {"when":{"on":"key","key":"jump","edge":"pressed"},"state":null,"if":"paused","do":[{"do":"if","cond":"choice == 0","then":[{"do":"resume"}],"else":[]},{"do":"if","cond":"choice == 1","then":[{"do":"set_sound","enabled":"not sound_on"}],"else":[]},{"do":"if","cond":"choice == 2","then":[{"do":"set_music","enabled":"not music_on"}],"else":[]},{"do":"if","cond":"choice == 3","then":[{"do":"resume"},{"do":"restart_level"}],"else":[]}]},
 {"when":{"on":"paused"},"state":null,"if":null,"do":[{"do":"draw","id":"menu_bg","shape":"rect","anchor":"center","x":"0","y":"0","w":"180","h":"130","color":"#000000","alpha":"0.75"},{"do":"draw","id":"menu_sel","shape":"rect","anchor":"center","x":"0","y":"-36 + choice * 24","w":"160","h":"20","color":"#3a6df0"},{"do":"draw","id":"menu_0","shape":"text","anchor":"center","x":"0","y":"-36","text":"Resume","size":"14","color":"#ffffff"},{"do":"draw","id":"menu_1","shape":"text","anchor":"center","x":"0","y":"-12","text":"Sound: {pick(sound_on, 'on', 'off')}","size":"14","color":"#ffffff"},{"do":"draw","id":"menu_2","shape":"text","anchor":"center","x":"0","y":"12","text":"Music: {pick(music_on, 'on', 'off')}","size":"14","color":"#ffffff"},{"do":"draw","id":"menu_3","shape":"text","anchor":"center","x":"0","y":"36","text":"Restart","size":"14","color":"#ffffff"},{"do":"set","var":"shown","value":"true"}]},
 {"when":{"on":"tick"},"state":null,"if":"shown","do":[{"do":"erase","id":"menu_bg"},{"do":"erase","id":"menu_sel"},{"do":"repeat","times":"4","then":[{"do":"erase","id":"menu_{i}"}]},{"do":"set","var":"shown","value":"false"}]}]}`,
  },
  {
    title: 'a score shown in the top right corner (another script adds to "score", e.g. a coin: {"do":"set","var":"score","value":"score + 10","on":"other"})',
    json: `{"name":"Score","description":"Shows the score in the top right corner.","vars":[{"name":"score","value":0}],"states":[],"handlers":[
 {"when":{"on":"tick"},"state":null,"if":null,"do":[{"do":"draw","id":"score","shape":"text","anchor":"top_right","x":"-16","y":"16","text":"Score {score}","size":"16","color":"#ffffff"}]}]}`,
  },
  {
    title: 'hearts in the top left corner showing the player\'s health (on the player)',
    json: `{"name":"Hearts","description":"Draws one heart per point of health, faded when lost.","vars":[],"states":[],"handlers":[
 {"when":{"on":"tick"},"state":null,"if":null,"do":[{"do":"repeat","times":"self.max_health","then":[{"do":"draw","id":"heart{i}","shape":"circle","anchor":"top_left","x":"16 + i * 26","y":"16","w":"20","h":"20","color":"#ff4d6d","alpha":"i < self.health ? 1 : 0.25"}]}]}]}`,
  },
  {
    title: 'a health bar in the top left corner (on the player)',
    json: `{"name":"Health bar","description":"A bar that shrinks as the player loses health.","vars":[],"states":[],"handlers":[
 {"when":{"on":"tick"},"state":null,"if":null,"do":[{"do":"draw","id":"bar_back","shape":"rect","anchor":"top_left","x":"16","y":"16","w":"104","h":"14","color":"#222222"},{"do":"draw","id":"bar","shape":"rect","anchor":"top_left","x":"18","y":"18","w":"100 * self.health / max(1, self.max_health)","h":"10","color":"#4ade80"}]}]}`,
  },
  {
    title: 'a wall jump (on the player; adds to the normal jump, which stays as it is): Jump in the air while touching a wall leaps up and away from it; holding toward a wall while falling slides down it slowly',
    json: `{"name":"Wall jump","description":"Press Jump in the air against a wall to leap up and away from it; hold toward a wall while falling to slide down slowly.","vars":[{"name":"push","value":220,"setting":true},{"name":"lift","value":0.95,"setting":true},{"name":"slide","value":90,"setting":true},{"name":"lock","value":0},{"name":"control","value":0.6}],"states":[],"handlers":[
 {"when":{"on":"start"},"state":null,"if":null,"do":[{"do":"set","var":"control","value":"field(self, 'CharacterController.airControl')"}]},
 {"when":{"on":"tick"},"state":null,"if":"not self.grounded and not self.climbing and pressed('jump') and (solid_at(self.x - self.width / 2 - 2, self.y) or solid_at(self.x + self.width / 2 + 2, self.y))","do":[{"do":"velocity","x":"pick(solid_at(self.x - self.width / 2 - 2, self.y), push, -push)","y":"-field(self, 'CharacterController.jumpForce') * lift"},{"do":"set_field","component":"CharacterController","field":"airControl","value":"0","on":null},{"do":"set","var":"lock","value":"0.2"}]},
 {"when":{"on":"tick"},"state":null,"if":"not self.grounded and self.vy > slide and ((key('left') and solid_at(self.x - self.width / 2 - 2, self.y)) or (key('right') and solid_at(self.x + self.width / 2 + 2, self.y)))","do":[{"do":"velocity","x":null,"y":"slide"}]},
 {"when":{"on":"tick"},"state":null,"if":"lock > 0","do":[{"do":"set","var":"lock","value":"pick(self.grounded, 0, lock - dt)"},{"do":"if","cond":"lock <= 0","then":[{"do":"set_field","component":"CharacterController","field":"airControl","value":"control","on":null}],"else":[]}]}]}`,
  },
];
